"""Code analysis tool - static analysis for test planning."""

import json
import os
from agent.tool_registry import tool


@tool(
    name="analyze_code",
    description="Analyze source code to identify testing priorities. Finds: complex functions (high cyclomatic complexity), error handlers, external dependencies, data flows. Supports Python, Java, Go.",
    parameters={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Path to source file or directory to analyze"},
            "language": {"type": "string", "enum": ["python", "java", "go", "auto"], "description": "Source language or auto-detect"},
            "max_depth": {"type": "integer", "description": "Max directory depth (default 2)"},
        },
        "required": ["path"],
    }
)
def analyze_code(path: str, language: str = "auto", max_depth: int = 2) -> str:
    if not os.path.exists(path):
        return f"Error: path not found: {path}"

    # Collect files
    files = []
    if os.path.isfile(path):
        files = [path]
    else:
        for root, dirs, _ in os.walk(path):
            depth = root[len(path):].count(os.sep)
            if depth >= max_depth:
                dirs.clear()
            for fname in sorted(os.listdir(root)):
                fpath = os.path.join(root, fname)
                if os.path.isfile(fpath):
                    # Auto-detect language by extension
                    ext = os.path.splitext(fname)[1]
                    if language == "auto" or language == "python":
                        if ext == ".py":
                            files.append(fpath)
                    if language == "auto" or language in ("java", "go"):
                        if ext in (".java", ".go"):
                            files.append(fpath)
                    if language != "auto":
                        if ext in (".py", ".java", ".go") and language not in ("python", "java", "go"):
                            continue

    results = {
        "files_analyzed": len(files),
        "language": language,
        "functions": [],
        "error_handlers": [],
        "imports_dependencies": [],
        "suggestions": [],
    }

    for fpath in files[:20]:  # Limit to 20 files
        try:
            with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                source = f.read()
        except Exception:
            continue

        lines = source.split("\n")
        ext = os.path.splitext(fpath)[1]

        if ext == ".py":
            _analyze_python(fpath, lines, results)
        elif ext == ".java":
            _analyze_java(fpath, lines, results)
        elif ext == ".go":
            _analyze_go(fpath, lines, results)

    # Generate test suggestions
    results["suggestions"] = [
        f"Total {len(results['functions'])} functions found - prioritize high-complexity ones",
        f"Found {len(results['error_handlers'])} error handlers - generate exception test cases",
        f"Found {len(results['imports_dependencies'])} external dependencies - identify mock targets",
    ]

    return json.dumps(results, ensure_ascii=False, indent=2)


def _analyze_python(fpath: str, lines: list[str], results: dict):
    current_func = None
    current_complexity = 1

    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()

        # Function detection
        if stripped.startswith("def ") or stripped.startswith("async def "):
            if current_func:
                results["functions"].append(current_func)
            name = stripped.split("(")[0].replace("def ", "").replace("async def ", "").strip()
            current_func = {"file": fpath, "name": name, "line": lineno, "complexity": 1}
            current_complexity = 1

        # Complexity counting
        if current_func:
            for kw in ["if ", "elif ", "for ", "while ", "except ", "and ", "or "]:
                if kw in stripped and not stripped.startswith("#"):
                    current_complexity += 1
            current_func["complexity"] = current_complexity

        # Error handlers
        if stripped.startswith("except ") or stripped.startswith("except:"):
            results["error_handlers"].append({"file": fpath, "line": lineno, "handler": stripped})

        # Imports
        if stripped.startswith("import ") or stripped.startswith("from "):
            results["imports_dependencies"].append({"file": fpath, "line": lineno, "import": stripped})

    if current_func:
        results["functions"].append(current_func)

    # Sort by complexity
    results["functions"].sort(key=lambda f: f["complexity"], reverse=True)


def _analyze_java(fpath: str, lines: list[str], results: dict):
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()

        # Method detection (basic)
        if any(kw in stripped for kw in ["public ", "private ", "protected "]) and "(" in stripped and ")" in stripped:
            if not stripped.endswith(";") and "class " not in stripped:
                name = stripped.split("(")[0].split()[-1]
                results["functions"].append({"file": fpath, "name": name, "line": lineno, "complexity": 1})

        # Error handling
        if "catch" in stripped or "throws " in stripped:
            results["error_handlers"].append({"file": fpath, "line": lineno, "handler": stripped})

        # Dependencies
        if stripped.startswith("import "):
            results["imports_dependencies"].append({"file": fpath, "line": lineno, "import": stripped})


def _analyze_go(fpath: str, lines: list[str], results: dict):
    for lineno, line in enumerate(lines, 1):
        stripped = line.strip()

        if stripped.startswith("func "):
            name = stripped.split("func ")[1].split("(")[0]
            results["functions"].append({"file": fpath, "name": name, "line": lineno, "complexity": 1})

        if "err !=" in stripped or "if err" in stripped:
            results["error_handlers"].append({"file": fpath, "line": lineno, "handler": stripped})

        if stripped.startswith("import "):
            results["imports_dependencies"].append({"file": fpath, "line": lineno, "import": stripped})
