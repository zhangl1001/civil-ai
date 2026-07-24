"""
Agent Registry — manages sub-agent definitions with lazy loading.

Each agent is a .md file with YAML frontmatter following Claude Code conventions:
  - name: agent identifier
  - description: when to use this agent
  - tools / allowed-tools: tool allowlist
  - model: model override (sonnet/opus/haiku/fable)
  - metadata: free-form {category, version, ...}

Agents are discovered from agent/sub_agents/ and ~/.zhangl-agent/agents/.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from skills.skill_registry import _parse_frontmatter


@dataclass
class AgentDefinition:
    """A sub-agent definition, aligned with Claude Code agent conventions."""
    name: str
    description: str
    system_prompt: str
    # Standard fields
    license: str = ""
    compatibility: str = ""
    allowed_tools: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    # Agent-specific
    tools: list[str] = field(default_factory=list)       # legacy alias for allowed_tools
    model: str = ""                                       # model override (sonnet/opus/haiku)
    model_tier: str = "fast"                              # zhangl-agent: fast / smart


class AgentRegistry:
    """Manages agent definitions. Independent from Skills system."""

    def __init__(self):
        self._agents: dict[str, AgentDefinition] = {}

    def register(self, agent: AgentDefinition):
        self._agents[agent.name] = agent

    def auto_discover(self, *dirs: str):
        for dir_path in dirs:
            base = Path(dir_path)
            if not base.is_dir():
                continue
            for md_file in sorted(base.glob("*.md")):
                md_text = md_file.read_text(encoding="utf-8")
                fm = _parse_frontmatter(md_text)
                body = md_text[md_text.find("---", md_text.find("---", 3) + 3) + 3:].strip()

                name = str(fm.get("name", md_file.stem))
                description = str(fm.get("description", ""))

                # Tools: supports both "tools" (legacy) and "allowed-tools" (standard)
                tools_raw = fm.get("tools", fm.get("allowed-tools", []))
                if isinstance(tools_raw, str):
                    tools_list = [s.strip() for s in tools_raw.replace(",", " ").split() if s.strip()]
                elif isinstance(tools_raw, list):
                    tools_list = tools_raw
                else:
                    tools_list = []

                # Standard fields
                license_ = str(fm.get("license", ""))
                compat = str(fm.get("compatibility", ""))
                metadata = fm.get("metadata", {})
                if not isinstance(metadata, dict):
                    metadata = {}

                # Model: "model" (Claude Code style) takes precedence over "model_tier" (legacy)
                model = str(fm.get("model", ""))
                model_tier = str(fm.get("model_tier", "fast"))

                self.register(AgentDefinition(
                    name=name,
                    description=description,
                    system_prompt=body,
                    license=license_,
                    compatibility=compat,
                    allowed_tools=tools_list,
                    metadata=metadata,
                    tools=tools_list,
                    model=model,
                    model_tier=model_tier,
                ))

    def get(self, name: str) -> AgentDefinition | None:
        return self._agents.get(name)

    def list_all(self) -> list[AgentDefinition]:
        return list(self._agents.values())

    def get_agent_list(self) -> str:
        """Return 'name: description' lines for system prompt injection."""
        lines = []
        for name, agent in sorted(self._agents.items()):
            tags = []
            if agent.model:
                tags.append(agent.model)
            elif agent.model_tier:
                tags.append(agent.model_tier)
            tag_str = f" ({', '.join(tags)})" if tags else ""
            lines.append(f"- {name}: {agent.description}{tag_str}")
        return "\n".join(lines)
