"""
Skill Registry — groups tools into skills with lazy loading.

Reference: Claude Code Skills pattern
  Layer 1: skill descriptions always available (tiny, ~50 tokens)
  Layer 2: SKILL.md full text loaded on demand
  Layer 3: tool schemas registered only when skill is activated

Core tools (from tools/core/) are always visible. Skill tools load/unload on demand.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from agent.tool_registry import Tool

# ── YAML-like frontmatter parser (no dependency) ─────────────────────

def _parse_value(val: str):
    """Parse a scalar YAML value: string, bool, int, list."""
    val = val.strip()
    if not val:
        return ""
    if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
        return val[1:-1]
    if val.lower() in ("true", "yes"):
        return True
    if val.lower() in ("false", "no"):
        return False
    if val.startswith("[") and val.endswith("]"):
        inner = val[1:-1].strip()
        return [s.strip().strip("\"'") for s in inner.split(",") if s.strip()] if inner else []
    if val.isdigit():
        return int(val)
    return val


def _parse_frontmatter(text: str) -> dict:
    """Parse YAML-like frontmatter from SKILL.md.

    Supports Agent Skills Open Standard fields including nested blocks:
      metadata:
        package: 'xxx'
        version: '1.0.0'
      allowed-tools: Read, Write, Bash
    """
    if not text.startswith("---"):
        return {}
    end = text.find("---", 3)
    if end < 0:
        return {}
    block = text[3:end].strip()
    lines = block.split("\n")
    result: dict = {}
    i = 0
    while i < len(lines):
        raw_line = lines[i]
        line = raw_line.strip()
        if not line or line.startswith("#"):
            i += 1
            continue
        if ":" not in line:
            i += 1
            continue

        # Check for nested block (indented lines after a key:)
        if line.endswith(":") and not _parse_value(line.split(":", 1)[1]):
            key = line[:-1].strip()
            nested: dict = {}
            indent = len(raw_line) - len(raw_line.lstrip())
            i += 1
            while i < len(lines):
                sub_line = lines[i]
                sub_stripped = sub_line.strip()
                if not sub_stripped or sub_stripped.startswith("#"):
                    i += 1
                    continue
                sub_indent = len(sub_line) - len(sub_line.lstrip())
                if sub_indent <= indent:
                    break  # back to parent level
                if ":" in sub_stripped:
                    sk, _, sv = sub_stripped.partition(":")
                    nested[sk.strip()] = _parse_value(sv)
                i += 1
            result[key] = nested
            continue

        # Flat key: value
        key, _, val = line.partition(":")
        result[key.strip()] = _parse_value(val)
        i += 1
    return result


# ── Skill dataclass ───────────────────────────────────────────────────

@dataclass
class Skill:
    """A skill following Agent Skills Open Standard + zhangl-agent extensions.

    Standard fields (agentskills.io):
      name, description, license, compatibility, allowed-tools, metadata
    zhangl-agent extensions (kept for backward compat):
      auto_load, match_keywords
    """
    name: str
    description: str
    # Agent Skills Open Standard
    license: str = ""
    compatibility: str = ""           # comma-separated platform list, e.g. "claude,zhangl-agent"
    allowed_tools: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)  # free-form: package, version, category, gate, ...
    # zhangl-agent extensions
    tools: list[Tool] = field(default_factory=list)
    auto_load: bool = False
    match_keywords: list[str] = field(default_factory=list)
    skill_md_path: str = ""
    skill_md_body: Optional[str] = None


# ── SkillRegistry ─────────────────────────────────────────────────────

class SkillRegistry:
    """Manages skills and their tool registration lifecycle.

    Owns tools directly — no separate ToolRegistry wrapper.
    - Core tools (discover_core): always visible
    - Skill tools (load_skill/unload_skill): on-demand
    - list_all() returns only visible tools → sent to LLM
    """

    def __init__(self):
        self._skills: dict[str, Skill] = {}
        self._loaded: set[str] = set()
        self._tools: dict[str, Tool] = {}
        self._visible_tools: dict[str, Tool] = {}
        self._core_tool_names: set[str] = set()
        self._turn_counter = 0
        self._skill_last_used: dict[str, int] = {}

    # ── Core tool discovery (tools/core/ → always visible) ────────

    def discover_core(self, tools_dir: str = "tools") -> list[str]:
        """Scan tools_dir for @tool-decorated functions and register as core tools.

        Core tools are always visible (never auto-unloaded).
        Uses manifest.json if present to filter enabled paths.

        Returns list of tool names that were registered.
        """
        registered = []
        base = Path(tools_dir).resolve()
        if not base.is_dir():
            return registered

        # Check manifest.json for enabled paths
        manifest_file = base / "manifest.json"
        enabled_paths = None
        if manifest_file.is_file():
            try:
                with open(manifest_file, encoding="utf-8") as f:
                    manifest = json.loads(f.read()) if json else {}
                enabled_paths = set(manifest.get("enabled", []))
            except Exception:
                pass

        package_root = base.parent

        for py_file in sorted(base.rglob("*.py")):
            if py_file.name == "__init__.py" and py_file.parent == base:
                continue

            if enabled_paths is not None:
                rel = py_file.relative_to(base)
                allowed = False
                for ep in enabled_paths:
                    ep_path = Path(ep)
                    try:
                        rel.relative_to(ep_path)
                        allowed = True
                        break
                    except ValueError:
                        pass
                if not allowed:
                    continue

            module_name = str(py_file.resolve().with_suffix("").relative_to(package_root)).replace(os.sep, ".")
            try:
                if module_name in sys.modules:
                    module = sys.modules[module_name]
                else:
                    spec = importlib.util.spec_from_file_location(module_name, py_file)
                    if spec is None or spec.loader is None:
                        continue
                    module = importlib.util.module_from_spec(spec)
                    sys.modules[module_name] = module
                    spec.loader.exec_module(module)

                for attr_name in dir(module):
                    obj = getattr(module, attr_name)
                    meta = getattr(obj, "_tool_meta", None)
                    if meta and callable(obj):
                        tool = Tool(
                            name=meta["name"],
                            description=meta["description"],
                            func=obj,
                            parameters=meta["parameters"],
                            category=meta.get("category", ""),
                        )
                        self._tools[tool.name] = tool
                        self._visible_tools[tool.name] = tool
                        self._core_tool_names.add(tool.name)
                        registered.append(meta["name"])
            except Exception as e:
                import warnings
                warnings.warn(f"Failed to load tools from {py_file}: {e}")

        return registered

    # ── Registration / Discovery ────────────────────────────────

    def register_skill(self, skill: Skill):
        """Register a skill (does NOT activate it)."""
        self._skills[skill.name] = skill

    def auto_discover(self, *dirs: str):
        """Scan directories for skills.

        Each skill is a directory containing:
          - SKILL.md (required): YAML frontmatter + markdown body
          - tools.py (optional): @tool-decorated functions
        """
        _parent_manifests: dict[str, set] = {}

        for dir_path in dirs:
            base = Path(dir_path)
            if not base.is_dir():
                continue

            parent = base.parent
            if str(parent) not in _parent_manifests:
                mf = parent / "manifest.json"
                if mf.is_file():
                    try:
                        with open(mf, encoding="utf-8") as f:
                            manifest = json.loads(f.read()) if json else {}
                        _parent_manifests[str(parent)] = set(manifest.get("enabled", []))
                    except Exception:
                        _parent_manifests[str(parent)] = None
                else:
                    _parent_manifests[str(parent)] = None

            enabled_dirs = _parent_manifests[str(parent)]

            for skill_dir in sorted(base.iterdir()):
                if not skill_dir.is_dir():
                    continue
                if enabled_dirs is not None and skill_dir.name not in enabled_dirs:
                    continue

                md_file = skill_dir / "SKILL.md"
                if not md_file.is_file():
                    continue

                md_text = md_file.read_text(encoding="utf-8")
                fm = _parse_frontmatter(md_text)
                body = md_text[md_text.find("---", md_text.find("---", 3) + 3) + 3:].strip()

                name = str(fm.get("name", skill_dir.name))
                description = str(fm.get("description", ""))

                # Standard fields
                license_ = str(fm.get("license", ""))
                compat = str(fm.get("compatibility", ""))
                allowed_raw = fm.get("allowed-tools", fm.get("allowed_tools", []))
                if isinstance(allowed_raw, str):
                    allowed_tools = [s.strip() for s in allowed_raw.replace(",", " ").split() if s.strip()]
                elif isinstance(allowed_raw, list):
                    allowed_tools = allowed_raw
                else:
                    allowed_tools = []
                metadata = fm.get("metadata", {})
                if not isinstance(metadata, dict):
                    metadata = {}

                # zhangl-agent extensions (backward compat)
                auto_load = bool(fm.get("auto_load", False))
                match_kw = fm.get("match_keywords", fm.get("match_keywords", []))
                if isinstance(match_kw, str):
                    match_kw = [s.strip() for s in match_kw.split(",") if s.strip()]

                tools_list: list[Tool] = []
                tools_py = skill_dir / "tools.py"
                if tools_py.is_file():
                    tools_list = self._load_tools_from_file(tools_py, fm.get("tools", []))

                self.register_skill(Skill(
                    name=name,
                    description=description,
                    license=license_,
                    compatibility=compat,
                    allowed_tools=allowed_tools,
                    metadata=metadata,
                    tools=tools_list,
                    auto_load=auto_load,
                    match_keywords=match_kw,
                    skill_md_path=str(md_file),
                    skill_md_body=body,
                ))

                req_file = skill_dir / "requirements.txt"
                if req_file.is_file():
                    self._install_requirements(req_file)

    @staticmethod
    def _load_tools_from_file(tools_py: Path, expected_tools: list) -> list[Tool]:
        """Import tools.py and extract @tool-decorated functions."""
        module_name = f"skills._dynamic_{tools_py.stem}_{hash(str(tools_py.resolve()))}"
        if module_name in sys.modules:
            module = sys.modules[module_name]
        else:
            spec = importlib.util.spec_from_file_location(module_name, tools_py)
            if spec is None or spec.loader is None:
                return []
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            try:
                spec.loader.exec_module(module)
            except Exception as e:
                import warnings
                warnings.warn(f"Failed to load skill tools from {tools_py}: {e}")
                return []

        expected_set = set(expected_tools) if expected_tools else None

        tools_list: list[Tool] = []
        for attr_name in dir(module):
            obj = getattr(module, attr_name)
            meta = getattr(obj, "_tool_meta", None)
            if meta and callable(obj):
                tool_name = meta["name"]
                if expected_set and tool_name not in expected_set:
                    continue
                tools_list.append(Tool(
                    name=tool_name,
                    description=meta["description"],
                    func=obj,
                    parameters=meta["parameters"],
                    category=meta.get("category", ""),
                ))
        return tools_list

    @staticmethod
    def _install_requirements(req_file: Path):
        import subprocess
        try:
            result = subprocess.run(
                [sys.executable, "-m", "pip", "install", "-q", "-r", str(req_file)],
                capture_output=True, text=True, timeout=120
            )
            if result.returncode != 0:
                import warnings
                warnings.warn(f"Failed to install skill requirements from {req_file}: {result.stderr[:200]}")
        except Exception as e:
            import warnings
            warnings.warn(f"Failed to install skill requirements: {e}")

    # ── Load / Unload ───────────────────────────────────────────

    def load_skill(self, name: str) -> Skill:
        """Activate a skill: register its tools as visible."""
        skill = self._skills.get(name)
        if not skill:
            raise KeyError(f"Unknown skill: {name}")

        if name in self._loaded:
            return skill

        for tool in skill.tools:
            self._tools[tool.name] = tool
            self._visible_tools[tool.name] = tool
        self._loaded.add(name)
        self._record_use(name)
        return skill

    def unload_skill(self, name: str):
        """Deactivate a skill: remove its tools from visible set only.

        Tools stay in _tools so in-flight parallel executions can still look
        them up via get()/execute(). They'll be overwritten on reload.
        """
        skill = self._skills.get(name)
        if not skill:
            raise KeyError(f"Unknown skill: {name}")

        for tool in skill.tools:
            self._visible_tools.pop(tool.name, None)
        self._loaded.discard(name)
        self._skill_last_used.pop(name, None)

    def is_loaded(self, name: str) -> bool:
        return name in self._loaded

    def list_loaded(self) -> list[str]:
        return sorted(self._loaded)

    # ── Queries ─────────────────────────────────────────────────

    def get_skill_list(self) -> str:
        """Layer 1: compact skill list for system prompt.

        Only name + description — no tags. The model uses description text
        for semantic matching, tags add noise without improving accuracy.
        """
        lines = []
        for name, skill in sorted(self._skills.items()):
            status = " [loaded]" if name in self._loaded else ""
            lines.append(f"- {name}: {skill.description}{status}")
        return "\n".join(lines)

    def load_skill_md(self, name: str) -> str:
        """Layer 2: return full SKILL.md body content."""
        skill = self._skills.get(name)
        if not skill:
            return f"Error: unknown skill '{name}'"
        if skill.skill_md_body:
            return skill.skill_md_body
        try:
            with open(skill.skill_md_path, "r", encoding="utf-8") as f:
                content = f.read()
            if content.startswith("---"):
                end = content.find("---", content.find("---", 3) + 3)
                if end > 0:
                    content = content[end + 3:].strip()
            skill.skill_md_body = content
            return content
        except Exception as e:
            return f"Error reading SKILL.md: {e}"

    def list_all(self) -> list[Tool]:
        """Return tools visible to LLM (core + loaded skill tools)."""
        return list(self._visible_tools.values())

    def register(self, tool: Tool):
        """Register a tool directly (for meta-tools). Always visible."""
        self._tools[tool.name] = tool
        self._visible_tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def execute(self, name: str, args: dict) -> str:
        tool = self._tools.get(name)
        if not tool:
            return f"Error: unknown tool '{name}'"
        if tool._is_async:
            return f"Error: '{name}' is async, must be awaited directly"
        try:
            return tool.execute(**args)
        except Exception as e:
            return f"Error executing {name}: {e}"

    def list_available(self) -> list[Skill]:
        return list(self._skills.values())

    def get_skill(self, name: str) -> Optional[Skill]:
        return self._skills.get(name)

    # ── Auto-unload tracking ────────────────────────────────────

    def record_tool_use(self, tool_name: str):
        for skill in self._skills.values():
            if skill.name not in self._loaded:
                continue
            for t in skill.tools:
                if t.name == tool_name:
                    self._record_use(skill.name)
                    return

    def _record_use(self, skill_name: str):
        self._skill_last_used[skill_name] = self._turn_counter

    def advance_turn(self):
        self._turn_counter += 1

    def auto_unload_stale(self, max_turns: int = 8) -> list[str]:
        """Unload skills not used for max_turns turns. Returns unloaded skill names."""
        unloaded = []
        for name in list(self._loaded):
            skill = self._skills.get(name)
            if not skill or skill.auto_load:
                continue
            last = self._skill_last_used.get(name, 0)
            if self._turn_counter - last > max_turns:
                self.unload_skill(name)
                unloaded.append(name)
        return unloaded

    # ── Semantic matching (Claude Code style) ────────────────────

    @staticmethod
    def _ngrams(s: str, n: int = 2) -> set:
        """Character n-grams for fuzzy matching."""
        s = s.lower()
        return {s[i:i+n] for i in range(len(s) - n + 1)}

    @staticmethod
    def _jaccard(a: set, b: set) -> float:
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)

    def match_skills(self, user_input: str, threshold: float = 0.15) -> list[Skill]:
        """Auto-match relevant skills based on user input.

        Uses character 2-gram Jaccard similarity against skill description
        + exact keyword matching. Returns skills above threshold, sorted by score.

        Called by engine.run() before each LLM turn — Claude Code style
        semantic activation, no manual load_skill needed.
        """
        if not user_input.strip():
            return []

        input_lower = user_input.lower()
        input_ngrams = self._ngrams(user_input)
        scored: list[tuple[float, Skill]] = []

        for skill in self._skills.values():
            if skill.name in self._loaded:
                continue  # already loaded

            # Description similarity (2-gram Jaccard)
            desc_ngrams = self._ngrams(skill.description)
            desc_score = self._jaccard(input_ngrams, desc_ngrams)

            # Keyword exact match bonus
            kw_score = 0.0
            matched_kws = []
            for kw in skill.match_keywords:
                if kw.lower() in input_lower:
                    kw_score += 0.3
                    matched_kws.append(kw)
                else:
                    # Character-overlap fallback for CJK keywords.
                    # "出题" won't substring-match "出几道题", but all its
                    # characters appear in the input — still a strong signal.
                    kw_chars = set(kw)
                    if len(kw_chars) >= 2 and kw_chars.issubset(set(input_lower)):
                        kw_score += 0.2
                        matched_kws.append(kw + "*")
            kw_score = min(kw_score, 0.6)  # cap keyword bonus

            # Name match bonus
            name_score = 0.0
            if skill.name.lower().replace("-", " ") in input_lower:
                name_score = 0.4

            total = desc_score + kw_score + name_score
            if total >= threshold:
                scored.append((total, skill))

        scored.sort(key=lambda x: x[0], reverse=True)
        return [skill for _, skill in scored]

    def get_matched_skill_bodies(self, user_input: str) -> str:
        """Get concatenated SKILL.md bodies for auto-matched skills.

        Returns empty string if no skills matched. Used to inject skill
        instructions before the LLM call.
        """
        matched = self.match_skills(user_input)
        if not matched:
            return ""

        parts = []
        for skill in matched[:3]:  # max 3 skills per turn
            body = self.load_skill_md(skill.name)
            if body:
                parts.append(f"<!-- skill: {skill.name} -->\n{body}")
            # Mark as loaded so tools become visible
            if skill.name not in self._loaded:
                self.load_skill(skill.name)

        return "\n\n---\n\n".join(parts)
