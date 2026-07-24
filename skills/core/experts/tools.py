"""Expert tools — spawn and kill sub-agents."""

from agent.tool_registry import tool

# Re-export from the original module. The @tool decorator is applied there,
# so we just import the decorated functions.
from tools.core.spawn_expert import spawn_expert, kill_expert
