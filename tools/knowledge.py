"""Knowledge base tools - accumulate and retrieve domain knowledge across sessions."""

import json
import os
import time
from agent.tool_registry import tool

# Default knowledge storage
_kb_dir = None
_embedding_model = None
_embedding_dim = None


def set_kb_dir(path: str):
    global _kb_dir
    _kb_dir = path
    os.makedirs(path, exist_ok=True)


def _get_embedding(text: str) -> list[float] | None:
    """Get embedding vector for text. Uses sentence-transformers if available, falls back to None (keyword mode)."""
    global _embedding_model, _embedding_dim
    if _embedding_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _embedding_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
            _embedding_dim = _embedding_model.get_sentence_embedding_dimension()
        except ImportError:
            return None
        except Exception:
            _embedding_model = None
            return None

    try:
        vec = _embedding_model.encode(text, normalize_embeddings=True)
        return vec.tolist()
    except Exception:
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


@tool(
    name="knowledge_collect",
    description="Extract and save domain knowledge from the current work session. Captures: project domain, common patterns, recurring issues, useful data patterns.",
    parameters={
        "type": "object",
        "properties": {
            "category": {"type": "string", "description": "Knowledge category: domain, boundary_values, defect_patterns, test_data, convention"},
            "content": {"type": "string", "description": "The knowledge to save (free text or JSON)"},
        },
        "required": ["category", "content"],
    }
)
def knowledge_collect(category: str, content: str) -> str:
    from cli.settings import SETTINGS_DIR as _sd
    kb_dir = _kb_dir or os.path.join(_sd, "knowledge")
    os.makedirs(kb_dir, exist_ok=True)

    filepath = os.path.join(kb_dir, f"{category}.json")
    existing = []
    if os.path.exists(filepath):
        try:
            with open(filepath, encoding="utf-8") as f:
                existing = json.load(f)
        except (json.JSONDecodeError, IOError):
            existing = []

    entry = {
        "timestamp": __import__("datetime").datetime.now().isoformat(),
        "content": content[:2000],
    }
    existing.append(entry)

    # Keep max 50 entries per category
    if len(existing) > 50:
        existing = existing[-50:]

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)

    return f"Knowledge saved to {category} ({len(existing)} entries total)"


@tool(
    name="knowledge_search",
    description="Search collected domain knowledge for relevant patterns, conventions, or insights.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query - keywords or topic"},
            "category": {"type": "string", "description": "Optional: filter by knowledge category"},
        },
        "required": ["query"],
    }
)
def knowledge_search(query: str, category: str = "") -> str:
    from cli.settings import SETTINGS_DIR as _sd
    kb_dir = _kb_dir or os.path.join(_sd, "knowledge")

    if not os.path.isdir(kb_dir):
        return json.dumps({"results": [], "hint": "No knowledge base yet. Use knowledge_collect to build it."}, ensure_ascii=False, indent=2)

    results = []
    query_lower = query.lower()
    keywords = [kw for kw in query_lower.split() if len(kw) > 1]

    for filename in sorted(os.listdir(kb_dir)):
        if not filename.endswith(".json"):
            continue
        cat = filename.replace(".json", "")
        if category and cat != category:
            continue

        filepath = os.path.join(kb_dir, filename)
        try:
            with open(filepath, encoding="utf-8") as f:
                entries = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue

        for entry in entries:
            content = entry.get("content", "").lower()
            score = sum(1 for kw in keywords if kw in content)
            if score > 0:
                results.append({
                    "category": cat,
                    "content": entry["content"][:300],
                    "timestamp": entry.get("timestamp", ""),
                    "relevance": score,
                })

    results.sort(key=lambda r: r["relevance"], reverse=True)
    top = results[:10]

    return json.dumps({
        "query": query,
        "total_found": len(results),
        "results": top,
        "method": "keyword",
    }, ensure_ascii=False, indent=2)


@tool(
    name="knowledge_semantic_search",
    description="Semantic (meaning-based) search across collected domain knowledge. Uses embedding vectors to find conceptually similar knowledge even when keywords don't match. Falls back to keyword search if sentence-transformers is not installed.",
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Search query in natural language (e.g. 'how to test login security')"},
            "top_k": {"type": "integer", "description": "Number of results to return (default 10, max 20)"},
        },
        "required": ["query"],
    }
)
def knowledge_semantic_search(query: str, top_k: int = 10) -> str:
    from cli.settings import SETTINGS_DIR as _sd
    kb_dir = _kb_dir or os.path.join(_sd, "knowledge")

    if not os.path.isdir(kb_dir):
        return json.dumps({"results": [], "hint": "No knowledge base yet. Use knowledge_collect to build it."}, ensure_ascii=False, indent=2)

    # Collect all entries
    all_entries = []
    for filename in sorted(os.listdir(kb_dir)):
        if not filename.endswith(".json"):
            continue
        cat = filename.replace(".json", "")
        filepath = os.path.join(kb_dir, filename)
        try:
            with open(filepath, encoding="utf-8") as f:
                entries = json.load(f)
        except (json.JSONDecodeError, IOError):
            continue
        for entry in entries:
            all_entries.append({
                "category": cat,
                "content": entry.get("content", ""),
                "timestamp": entry.get("timestamp", ""),
            })

    if not all_entries:
        return json.dumps({"results": [], "hint": "Knowledge base is empty"}, ensure_ascii=False, indent=2)

    # Try semantic search
    query_vec = _get_embedding(query)
    top_k = min(top_k, 20)

    if query_vec is not None:
        # Cache embeddings per entry to avoid re-encoding
        for i, entry in enumerate(all_entries):
            # Cache key: first 100 chars of content
            content_snippet = entry["content"][:100]
            if "_embedding" not in entry:
                content_vec = _get_embedding(entry["content"][:500])
                entry["_embedding"] = content_vec

            if entry.get("_embedding"):
                entry["_score"] = _cosine_similarity(query_vec, entry["_embedding"])
            else:
                entry["_score"] = 0.0

        all_entries.sort(key=lambda e: e.get("_score", 0), reverse=True)
        method = "semantic_embedding"
    else:
        # Keyword fallback
        query_lower = query.lower()
        keywords = [kw for kw in query_lower.split() if len(kw) > 1]
        for entry in all_entries:
            content_lower = entry["content"].lower()
            entry["_score"] = sum(1 for kw in keywords if kw in content_lower)
        all_entries.sort(key=lambda e: e.get("_score", 0), reverse=True)
        method = "keyword_fallback"

    results = []
    for entry in all_entries[:top_k]:
        if entry.get("_score", 0) > 0 or method == "semantic_embedding":
            results.append({
                "category": entry["category"],
                "content": entry["content"][:300],
                "timestamp": entry.get("timestamp", ""),
                "score": round(entry.get("_score", 0), 4),
            })

    # If semantic and no results with score > 0.3, fall back to keyword
    if method == "semantic_embedding" and (not results or results[0].get("score", 0) < 0.3):
        # Re-run with keyword
        query_lower = query.lower()
        keywords = [kw for kw in query_lower.split() if len(kw) > 1]
        for entry in all_entries:
            content_lower = entry["content"].lower()
            entry["_score"] = sum(1 for kw in keywords if kw in content_lower)
        all_entries.sort(key=lambda e: e.get("_score", 0), reverse=True)
        method = "semantic_then_keyword"
        results = []
        for entry in all_entries[:top_k]:
            if entry.get("_score", 0) > 0:
                results.append({
                    "category": entry["category"],
                    "content": entry["content"][:300],
                    "timestamp": entry.get("timestamp", ""),
                    "score": round(entry.get("_score", 0), 4),
                })

    return json.dumps({
        "query": query,
        "method": method,
        "total_found": len(all_entries),
        "results": results,
        "install_hint": None if method.startswith("semantic") or method == "semantic_then_keyword" else "For semantic search, install: pip install sentence-transformers",
    }, ensure_ascii=False, indent=2)
