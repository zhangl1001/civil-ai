"""
Interactive REPL — simple terminal UI using input() + ANSI escape codes.
No prompt_toolkit dependency.
"""

import os, sys, shutil, asyncio, time

from agent.engine import AgentEngine, AgentEvent, TextDelta, ToolCallStart, ToolCallResult, AgentDone, AgentError
from agent.llm_client import create_provider, detect_provider, ProviderType
from agent.system_prompt import MAIN_AGENT_PROMPT
from context.manager import ContextManager
from memory.store import MemoryStore, MemoryType
from session.manager import SessionManager
from tools.interaction import set_ask_callback
from tools.core.task_tools import reset_tasks
from tools.core.spawn_expert import set_expert_dependencies
from cli.settings import Settings, check_permission, get_user_dir


# ── ANSI codes ──────────────────────────────────────────────────────────

_ESC = "\033"
G = f"{_ESC}[32m"          # green
B = f"{_ESC}[1m"           # bold
D = f"{_ESC}[2m"           # dim
R = f"{_ESC}[0m"           # reset
Y = f"{_ESC}[33m"          # yellow
RD = f"{_ESC}[31m"         # red
USER_FG = f"{_ESC}[38;2;232;232;232m"   # #e8e8e8
USER_BG = f"{_ESC}[48;2;30;45;61m"      # #1e2d3d

HINT = (
    "公考练习 · /help 查看命令 · /model 切换模型 · /sessions 历史\n"
    "输入「每日计划」开始练习，或「批改」「薄弱分析」「错题本」「模拟考试」"
)

def tw():
    try: return shutil.get_terminal_size().columns
    except: return 80


def _sep(text: str = ""):
    """Green separator line filling terminal width."""
    w = tw()
    if text:
        suffix = f" {text} ──"
        n = w - len(suffix) - 1
        if n < 5: n = 5
        return f"{G}─{D}" + "─" * n + f"{R}{G} {text} ──{R}"
    return f"{G}{'─' * w}{R}"


def _tool_short(name: str, args: dict) -> str:
    """Ultra-concise tool label for progress line."""
    path = str(args.get("path", ""))[:30]
    return {
        "read_file": f"read {path}",
        "write_file": f"save {path}",
        "list_files": f"ls {path}",
        "parse_openapi": "parse openapi",
        "parse_markdown": "parse doc",
        "export_json": "export json",
        "export_excel": "export xlsx",
        "export_markdown": "export md",
        "ask_user": "ask",
        "spawn_expert": "delegate",
        "task_create": "plan",
    }.get(name, name)


def _clear_line():
    """Clear current terminal line."""
    sys.stdout.write("\r\033[K")
    sys.stdout.flush()


def _print_user_msg(text: str):
    """Print user message with dark blue background spanning terminal width."""
    w = tw()
    line = f"❯ {text}"
    pad = max(w - len(line), 0)
    print(f"{USER_FG}{USER_BG}{line}{' ' * pad}{R}")


# ── REPL ───────────────────────────────────────────────────────────────

class Repl:
    def __init__(self, settings: Settings, api_key="", api_base="", model="deepseek-chat", provider="", max_tokens=32768):
        self.settings = settings
        self.model = model
        self.provider = provider
        self.api_key = api_key
        self.api_base = api_base
        self.max_tokens = max_tokens
        self.project_root = os.path.dirname(os.path.dirname(__file__))
        self.storage_dir = os.path.join(get_user_dir(), "storage")

        if not self.api_key:
            from cli.settings import SETTINGS_FILE as sf
            msg = (
                f"No API key configured. Please edit {sf}:\n"
                '  "ai": { "providers": { "deepseek": { "api_key": "sk-your-key" } } }\n'
                "Get a key at https://platform.deepseek.com/api_keys"
            )
            print(f"{RD}{msg}{R}")
            import os as _os
            if not _os.isatty(0):
                raise RuntimeError(msg)
            sys.exit(1)

        self.sessions = SessionManager(self.storage_dir)

        # Token counters
        self._total_in = 0
        self._total_out = 0

        self._running = True

        self._init_agent()

    def _init_agent(self):
        pt = detect_provider(self.api_key, self.api_base, forced=self.provider)
        self.provider_label = {ProviderType.ANTHROPIC: "Anthropic", ProviderType.OPENAI: "OpenAI", ProviderType.OLLAMA: "Ollama"}[pt]
        self.llm = create_provider(pt, self.api_key, self.api_base, self.model, self.max_tokens, thinking_mode="auto")

        # Skill-based tool management — SkillRegistry owns all tools
        from skills.skill_registry import SkillRegistry
        from skills.meta_tools import create_meta_tools

        self.skill_registry = SkillRegistry()

        # Discover core tools (tools/core/ — always visible, never unloaded)
        tools_dir = os.path.join(self.project_root, "tools")
        self.skill_registry.discover_core(tools_dir)

        # Discover skills from built-in + user directories.
        # Built-in: project/skills/{core,optional}
        # User custom: ~/.zhangl-agent/skills/  (like Claude Code's ~/.claude/skills/)
        skills_dir = os.path.join(self.project_root, "skills")
        user_skills_dir = os.path.join(get_user_dir(), "skills")
        os.makedirs(user_skills_dir, exist_ok=True)
        self.skill_registry.auto_discover(
            os.path.join(skills_dir, "core"),
            os.path.join(skills_dir, "optional"),
            user_skills_dir,
        )

        # Register meta tools (always available, not part of any skill)
        for t in create_meta_tools(self.skill_registry):
            self.skill_registry.register(t)

        # Initialize AgentRegistry for expert sub-agents.
        # Built-in: project/agent/sub_agents/
        # User custom: ~/.zhangl-agent/agents/  (like Claude Code's ~/.claude/agents/)
        from agent.sub_agents.agent_registry import AgentRegistry
        self.agent_registry = AgentRegistry()
        agents_dir = os.path.join(self.project_root, "agent", "sub_agents")
        user_agents_dir = os.path.join(get_user_dir(), "agents")
        os.makedirs(user_agents_dir, exist_ok=True)
        self.agent_registry.auto_discover(agents_dir, user_agents_dir)

        # Auto-load core skills
        for skill in self.skill_registry.list_available():
            if skill.auto_load:
                self.skill_registry.load_skill(skill.name)

        from agent.engine import _load_thinking_turns
        self.ctx_mgr = ContextManager(keep_thinking_turns=_load_thinking_turns())
        if self.settings.memory.enabled:
            from cli.settings import SETTINGS_DIR as _sd
            mem_dir = self.settings.memory.storage_dir or os.path.join(_sd, "memory")
            self.memory = MemoryStore(mem_dir)
            mem_ctx = self.memory.get_context_injection()
        else:
            self.memory = None; mem_ctx = ""

        sp = MAIN_AGENT_PROMPT
        sp += f"\n\n## 运行环境\n当前模型：{self.model}，服务商：{self.provider_label}。被问及模型或 AI 服务商时，如实说明以上信息，不要猜测或声称自己是其他模型。"
        if mem_ctx: sp += "\n" + mem_ctx

        # Inject available skills list into system prompt (Layer 1: tiny)
        skill_list = self.skill_registry.get_skill_list()
        if skill_list:
            sp += "\n\n## Available Skills\n" + skill_list + "\nUse discover_skills to see details, load_skill to activate."

        # Shutdown old engine before creating new one (prevents thread leak)
        if hasattr(self, 'engine'):
            self.engine.shutdown()

        # Pass SkillRegistry to engine — its list_all() returns only loaded skill tools + meta tools
        self.engine = AgentEngine(self.llm, self.skill_registry, sp, self.ctx_mgr)
        set_ask_callback(self._handle_ask_user)
        set_expert_dependencies(self.llm, self.skill_registry, self.settings, self.agent_registry)

    def _session_name(self):
        if self.sessions.current_id:
            meta, _, _, _ = self.sessions.load(self.sessions.current_id)
            if meta and meta.name: return meta.name[:50]
        return "zhangl-agent"

    def _save_session(self):
        self.sessions.save(self.ctx_mgr.messages, self.ctx_mgr._summary, self.ctx_mgr._summarized_count)

    # ── Main REPL loop ─────────────────────────────────────────────

    def run(self):
        """Start the interactive REPL — simple input loop with ANSI output."""
        # Init session
        sessions = self.sessions.list_sessions(limit=1)
        resumed = False
        if sessions:
            last = sessions[0]
            meta, msgs, summary, count = self.sessions.resume(last.id)
            if meta and msgs:
                self.ctx_mgr.messages = msgs
                self.ctx_mgr._summary = summary
                self.ctx_mgr._summarized_count = count
                resumed = True
        if not resumed:
            self.sessions.create(self.model, self.provider_label.lower())

        # Display header
        print(_sep(self._session_name()))

        # Show history (skip system prompts)
        has_history = False
        for m in self.ctx_mgr.messages:
            role = m.get("role", "")
            if role == "system":
                continue
            content = str(m.get("content", ""))[:500]
            if role == "user":
                _print_user_msg(content)
            else:
                print(content)
            has_history = True

        if not has_history:
            print(f"{D}{HINT}{R}")

        print(_sep())
        self._print_status()

        # Main loop
        try:
            asyncio.run(self._repl_loop())
        except KeyboardInterrupt:
            print()
        finally:
            self._save_session()
            print(f"{D}Bye!{R}")

    async def _repl_loop(self):
        while self._running:
            try:
                line = input(f"{G}❯ {R}")
            except (EOFError, KeyboardInterrupt):
                print()
                break

            line = line.strip()
            if not line:
                continue

            if line.startswith("/"):
                await self._handle_command(line)
            else:
                await self._run_agent_turn(line)

            if self._running:
                self._print_status()

    def _print_status(self):
        cwd = self.project_root
        home = os.path.expanduser("~")
        if cwd.startswith(home):
            cwd = "~" + cwd[len(home):]
        print(f"{D}  {self.model}  |  {cwd}  |  In: {self._total_in}  Out: {self._total_out}{R}")

    # ── Agent turn ────────────────────────────────────────────────

    async def _run_agent_turn(self, line: str):
        total_in, total_out = 0, 0
        active_tools: dict[str, float] = {}  # tool_name -> start_time

        def _flush_tools():
            for name, t0 in list(active_tools.items()):
                dt = time.time() - t0
                print(f"\n  {D}✓{R} {name} ({dt:.1f}s)")
                active_tools.clear()

        try:
            async for event in self.engine.run(line):
                if isinstance(event, TextDelta):
                    if event.content:
                        _flush_tools()
                        sys.stdout.write(event.content)
                        sys.stdout.flush()
                elif isinstance(event, ToolCallStart):
                    allowed, reason = check_permission(self.settings, event.name, event.arguments)
                    if not allowed:
                        sys.stdout.write(f"\n  ⛔ {reason}\n")
                        continue
                    label = _tool_short(event.name, event.arguments)
                    active_tools[label] = time.time()
                    sys.stdout.write(f"\n  {D}...{R} {label}")
                    sys.stdout.flush()
                elif isinstance(event, ToolCallResult):
                    # Find and complete the matching tool
                    label = _tool_short(event.name, event.arguments)
                    if label in active_tools:
                        dt = time.time() - active_tools.pop(label)
                        _clear_line()
                        print(f"  {D}✓{R} {label} ({dt:.1f}s)")
                    # Show file size for saves
                    if event.name in ("write_file",) and "chars" in event.result:
                        import re
                        m = re.search(r"(\d+) chars", event.result)
                        if m:
                            sys.stdout.write(f"    {D}{m.group(1)} chars, {event.result.count(chr(10))+1} lines{R}")
                            sys.stdout.flush()
                elif isinstance(event, AgentDone):
                    _flush_tools()
                    if event.usage:
                        total_in = event.usage.get("input", 0)
                        total_out = event.usage.get("output", 0)
                elif isinstance(event, AgentError):
                    _flush_tools()
                    print(f"  {RD}✗{R} {event.message}")
        except asyncio.CancelledError:
            _flush_tools()
            print(f"\n  {Y}⏸ 执行已中断{R}")
            print(f"  {D}[s] 补充说明  [c] 继续  [q] 返回{R}")
            try:
                choice = input(f"  {G}❯ {R}").strip().lower()
            except (EOFError, KeyboardInterrupt):
                choice = "q"
            if choice == "s":
                try:
                    supplement = input(f"  {G}补充> {R}")
                except (EOFError, KeyboardInterrupt):
                    supplement = ""
                if supplement.strip():
                    self.ctx_mgr.add_message({"role": "user", "content": supplement})
                    self._save_session()
                    print(f"  {D}已记录补充说明，输入新指令继续...{R}")
            elif choice == "c":
                self.ctx_mgr.add_message({"role": "user", "content": "继续执行，从上次中断的地方继续"})
                self._save_session()
                print(f"  {D}已注入继续指令，输入新指令继续...{R}")
        except Exception as e:
            _flush_tools()
            print(f"  {RD}✗{R} {e}")

        _flush_tools()
        print()
        self._total_in = total_in
        self._total_out = total_out

        if self.settings.memory.enabled and self.memory:
            self.memory.remember(MemoryType.PROJECT, f"User: {line[:200]}", line[:80])
        self._save_session()

    # ── Commands ──────────────────────────────────────────────────

    async def _handle_command(self, cmd: str):
        parts = cmd.split(maxsplit=1)
        c = parts[0].lower()
        a = parts[1] if len(parts) > 1 else ""

        if c in ("/quit", "/exit"):
            self._save_session()
            print("Bye!")
            self._running = False

        elif c == "/help":
            print(f"""
  命令
  /load <file>      /describe <text>     /model <name>
  /export <path>    /sessions            /resume <id>
  /new              /undo                /config
  /pause on|off     /generate            /quit

  考公快捷指令（直接输入即可）：
  每日计划 / 出今天的题 / 批改 / 薄弱分析 / 错题本 / 模拟考试 / 备考计划
""")
        elif c == "/generate":
            await self._run_agent_turn("根据备考计划和能力画像出今天的练习")

        elif c == "/load":
            if not a: print("  /load <file>"); return
            if not os.path.exists(a): print(f"  Not found: {a}"); return
            with open(a, 'r', encoding='utf-8') as f:
                file_content = f.read()
            print(f"  {D}已加载 {len(file_content)} 字符，开始分析...{R}")
            await self._run_agent_turn(
                f"根据以下需求文档生成练习题。\n\n需求文档：\n{file_content}"
            )

        elif c == "/describe":
            if not a: print("  /describe <text>"); return
            await self._run_agent_turn(f"根据以下描述生成练习题:\n{a}")

        elif c == "/model":
            if not a:
                print(f"  当前: {self.model}  |  /model <name>")
                return
            old = self.model; self.model = a; self._init_agent()
            print(f"  {old} → {a}")

        elif c == "/pause":
            if a.lower() in ("on", "1", "true"):
                self.engine.set_pause_after_tools(True)
                print(f"  ⏸ 暂停模式已开启 — 每轮工具执行后会暂停等待补充")
            elif a.lower() in ("off", "0", "false"):
                self.engine.set_pause_after_tools(False)
                print(f"  ▶ 暂停模式已关闭")
            else:
                status = "开启" if self.engine._pause_after_tools else "关闭"
                print(f"  暂停模式: {status}  |  /pause on|off")

        elif c == "/undo":
            cp = self.ctx_mgr.undo()
            print(f"  {'Reverted' if cp else 'Nothing to undo'}")

        elif c == "/export":
            fmt = self.settings.export.default_format
            path = a or os.path.join(self.settings.export.default_dir, f"exam_report.{fmt}")
            await self._run_agent_turn(f"将当前练习数据导出为 {fmt} 格式，保存到 {path}")

        elif c == "/config":
            print(f"  Model: {self.model}  |  Provider: {self.provider_label}  |  Session: {self.sessions.current_id or 'none'}")
            print(f"  Export: {self.settings.export.default_format} → {self.settings.export.default_dir}  |  Memory: {'on' if self.settings.memory.enabled else 'off'}")

        elif c == "/sessions":
            sessions = self.sessions.list_sessions(20)
            if not sessions: print("  No past sessions"); return
            print("\n  会话历史\n")
            for s in sessions:
                m = f" ←" if s.id == self.sessions.current_id else ""
                print(f"  {s.id}  {s.name[:50]}{m}")
                print(f"       {s.model} · {s.message_count} msgs · {s.updated_at[:16]}")
            print()

        elif c == "/resume":
            if not a: print("  /resume <session-id>"); return
            self._save_session()
            meta, msgs, summary, count = self.sessions.resume(a)
            if not meta: print(f"  Not found: {a}"); return
            self.model = meta.model; self.provider = meta.provider
            self._init_agent()
            self.ctx_mgr.messages = msgs; self.ctx_mgr._summary = summary; self.ctx_mgr._summarized_count = count
            print(f"  已恢复: {meta.name} ({meta.message_count} msgs)")

        elif c == "/new":
            self._save_session()
            self.sessions.create(self.model, self.provider_label.lower())
            self.ctx_mgr = ContextManager(); self._init_agent()
            reset_tasks()
            print("  新会话")

        elif c == "/history":
            for i, m in enumerate(self.ctx_mgr.messages):
                role = m.get("role", "?")
                content = str(m.get("content", ""))[:100].replace("\n", " ")
                print(f"  [{i}] {role}: {content}")

        else:
            print(f"  Unknown: {c}")

    # ── Handle ask_user tool ──────────────────────────────────────

    def _handle_ask_user(self, question: str, options: list[str]) -> str:
        """Ask user during tool execution."""
        print(f"\n  ? {question}")
        if options:
            for i, opt in enumerate(options):
                print(f"    [{i+1}] {opt}")
        try:
            choice = input(f"  {G}❯ {R}")
        except (EOFError, KeyboardInterrupt):
            return ""
        if options and choice.isdigit():
            idx = int(choice) - 1
            if 0 <= idx < len(options):
                return options[idx]
        return choice

    # ── One-shot mode ─────────────────────────────────────────────

    async def process(self, text: str):
        """One-shot mode — print output directly, no TUI."""
        print()
        print(_sep())
        print(f"{G}❯{R} {text}")
        total_in, total_out = await self._stream_direct(text)
        print()
        print(_sep())
        print(f"{D}  {self.model}  |  {self.project_root}  |  In: {total_in}  Out: {total_out}{R}")
        print()

        if self.settings.memory.enabled and self.memory:
            self.memory.remember(MemoryType.PROJECT, f"User: {text[:200]}", text[:80])
        self._save_session()

    async def _stream_direct(self, text: str) -> tuple:
        """Stream agent output directly to stdout (for one-shot mode)."""
        total_in, total_out = 0, 0
        active_tools: dict[str, float] = {}

        def _flush_tools():
            for name, t0 in list(active_tools.items()):
                dt = time.time() - t0
                print(f"\n  {D}✓{R} {name} ({dt:.1f}s)")
                active_tools.clear()

        async for event in self.engine.run(text):
            if isinstance(event, TextDelta):
                if event.content:
                    _flush_tools()
                    sys.stdout.write(event.content); sys.stdout.flush()
            elif isinstance(event, ToolCallStart):
                label = _tool_short(event.name, event.arguments)
                active_tools[label] = time.time()
                sys.stdout.write(f"\n  {D}...{R} {label}")
                sys.stdout.flush()
            elif isinstance(event, ToolCallResult):
                label = _tool_short(event.name, event.arguments)
                if label in active_tools:
                    dt = time.time() - active_tools.pop(label)
                    _clear_line()
                    print(f"  {D}✓{R} {label} ({dt:.1f}s)")
            elif isinstance(event, AgentDone):
                _flush_tools()
                if event.usage:
                    total_in = event.usage.get("input", 0)
                    total_out = event.usage.get("output", 0)
            elif isinstance(event, AgentError):
                _flush_tools()
                print(f"\n  {RD}✗{R} {event.message}")

        _flush_tools()
        return total_in, total_out
