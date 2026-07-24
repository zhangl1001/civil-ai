"""Meta tools for skill management — always available.

These are registered manually to ToolRegistry (not via auto_discover).
"""

from agent.tool_registry import Tool


def create_meta_tools(skill_registry) -> list[Tool]:
    """Create discover_skills, load_skill, unload_skill tools bound to a SkillRegistry."""

    def _discover():
        return skill_registry.get_skill_list()

    def _load(name: str) -> str:
        try:
            skill = skill_registry.load_skill(name)
            md = skill_registry.load_skill_md(name)
            tools_list = ", ".join(t.name for t in skill.tools)
            return (
                f"Skill '{name}' loaded successfully.\n"
                f"Tools: {tools_list}\n"
                f"Instructions:\n{md}"
            )
        except KeyError:
            return f"Error: unknown skill '{name}'"
        except Exception as e:
            return f"Error loading skill: {e}"

    def _unload(name: str) -> str:
        try:
            skill_registry.unload_skill(name)
            return f"Skill '{name}' unloaded. Its tools are no longer available."
        except KeyError:
            return f"Error: unknown skill '{name}'"
        except Exception as e:
            return f"Error unloading skill: {e}"

    return [
        Tool(
            name="discover_skills",
            description="List all available skills with descriptions. Use this to see what skills exist and decide which to load.",
            func=_discover,
            parameters={"type": "object", "properties": {}},
        ),
        Tool(
            name="load_skill",
            description="Activate a skill by name. Use discover_skills first to see available skills. Returns the skill's tools and instructions.",
            func=_load,
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill name to activate, e.g. 'web-search'"},
                },
                "required": ["name"],
            },
        ),
        Tool(
            name="unload_skill",
            description="Deactivate a skill by name to free context. The skill can be reloaded later with load_skill.",
            func=_unload,
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Skill name to deactivate, e.g. 'web-search'"},
                },
                "required": ["name"],
            },
        ),
    ]

