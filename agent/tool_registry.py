"""
Tool Registry - registers, describes, and executes tools.
Tools are the Agent's "hands and eyes" - pure functions the AI can call.

Supports auto-discovery: drop a new .py file with @tool-decorated functions
into the tools/ directory and it's automatically available to the agent.
"""

import inspect
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any, Callable, Optional
from agent.llm_client import ToolSchema


class Tool:
    def __init__(self, name: str, description: str, func: Callable, parameters: dict, category: str = ""):
        self.name = name
        self.description = description
        self.func = func
        self.parameters = parameters
        self.category = category  # "output" for tools that produce persistent output
        self._is_async = inspect.iscoroutinefunction(func)

    def execute(self, **kwargs) -> str:
        """Execute sync tool. Async tools are dispatched directly by engine/expert."""
        result = self.func(**kwargs)
        return str(result) if result is not None else "done"

    def to_schema(self) -> ToolSchema:
        return ToolSchema(
            name=self.name,
            description=self.description,
            parameters=self.parameters,
        )


class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool):
        self._tools[tool.name] = tool

    def get(self, name: str) -> Optional[Tool]:
        return self._tools.get(name)

    def list_all(self) -> list[Tool]:
        return list(self._tools.values())

    def execute(self, name: str, arguments: dict) -> str:
        """Execute a sync tool. Async tools must be awaited directly by the caller."""
        tool = self._tools.get(name)
        if not tool:
            return f"Error: unknown tool '{name}'"
        if tool._is_async:
            return f"Error: '{name}' is async, must be awaited directly"
        try:
            return tool.execute(**arguments)
        except Exception as e:
            return f"Error executing {name}: {e}"

    def auto_discover(self, tools_dir: str = "tools") -> list[str]:
        """Scan tools_dir for @tool-decorated functions and register them.

        If a manifest.json exists in tools_dir, only entries listed in "enabled"
        are scanned (relative paths from tools_dir). Otherwise all .py files
        are scanned.

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

        # Package root is the parent of the tools directory.
        # Module names are computed relative to this root so they match
        # what Python's import system uses (e.g. "tools.core.spawn_expert").
        package_root = base.parent

        # Walk all .py files (skip only root __init__.py)
        for py_file in sorted(base.rglob("*.py")):
            if py_file.name == "__init__.py" and py_file.parent == base:
                continue

            # If manifest restricts paths, skip files outside enabled entries
            if enabled_paths is not None:
                rel = py_file.relative_to(base)
                # Allow if file is directly listed or inside an enabled directory
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

                # Find all functions with _tool_meta
                for name in dir(module):
                    obj = getattr(module, name)
                    meta = getattr(obj, "_tool_meta", None)
                    if meta and callable(obj):
                        tool = Tool(
                            name=meta["name"],
                            description=meta["description"],
                            func=obj,
                            parameters=meta["parameters"],
                            category=meta.get("category", ""),
                        )
                        self.register(tool)
                        registered.append(meta["name"])
            except Exception as e:
                # Skip tools with missing dependencies
                import warnings
                warnings.warn(f"Failed to load tools from {py_file}: {e}")

        return registered


# Decorator for easy tool registration
def tool(name: str, description: str, parameters: dict, category: str = ""):
    def decorator(func: Callable):
        func._tool_meta = {"name": name, "description": description, "parameters": parameters, "category": category}
        return func
    return decorator
