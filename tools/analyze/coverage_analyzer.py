"""
Requirement coverage analyzer.
Maps requirements (from spec docs) to test cases, identifies gaps,
computes traceability matrix. Pure Python — fast and deterministic.
"""

import json
import os
import re
from cli.settings import get_user_dir
from agent.tool_registry import tool

PROJECT_ROOT = os.path.join(get_user_dir(), "projects")


def _extract_requirements(spec_dir: str) -> list[dict]:
    """Extract requirement items from spec markdown files.

    Parses:
    - `## Title` headers as requirement groups
    - `REQ-XXX: description` patterns
    - Numbered lists under headers
    - Bullet points as individual requirements
    """
    reqs = []
    if not os.path.isdir(spec_dir):
        return reqs

    header_stack = []  # (level, title)

    for fname in sorted(os.listdir(spec_dir)):
        fpath = os.path.join(spec_dir, fname)
        if not os.path.isfile(fpath):
            continue
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                text = f.read()
        except Exception:
            continue

        lines = text.split("\n")
        current_section = ""
        req_counter = 0

        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue

            # Track headers
            header_match = re.match(r'^(#{1,4})\s+(.+)', stripped)
            if header_match:
                level = len(header_match.group(1))
                title = header_match.group(2).strip()
                # Trim header stack
                while header_stack and header_stack[-1][0] >= level:
                    header_stack.pop()
                header_stack.append((level, title))
                current_section = " > ".join(h[1] for h in header_stack)
                continue

            # REQ-XXX pattern
            req_match = re.match(r'^(REQ-[\w-]+)\s*[:：]\s*(.+)', stripped)
            if req_match:
                reqs.append({
                    "id": req_match.group(1),
                    "title": req_match.group(2).strip(),
                    "section": current_section,
                    "source_file": fname,
                    "type": "explicit",
                })
                continue

            # Numbered list items under a section
            list_match = re.match(r'^(\d+)[.)]\s+(.+)', stripped)
            if list_match and current_section:
                req_counter += 1
                req_id = f"REQ-{_slugify(current_section)}-{req_counter:03d}"
                reqs.append({
                    "id": req_id,
                    "title": list_match.group(2).strip(),
                    "section": current_section,
                    "source_file": fname,
                    "type": "list_item",
                })
                continue

            # Bullet points under a section
            bullet_match = re.match(r'^[-*]\s+(.+)', stripped)
            if bullet_match and current_section:
                content = bullet_match.group(1).strip()
                # Skip short bullets that look like notes
                if len(content) > 10:
                    req_counter += 1
                    req_id = f"REQ-{_slugify(current_section)}-{req_counter:03d}"
                    reqs.append({
                        "id": req_id,
                        "title": content,
                        "section": current_section,
                        "source_file": fname,
                        "type": "bullet",
                    })

    # Deduplicate by title similarity
    return _deduplicate_reqs(reqs)


def _slugify(text: str) -> str:
    """Generate a short slug from section text."""
    # Take first meaningful segment
    slug = re.sub(r'[^a-zA-Z0-9一-鿿]+', '-', text.strip())
    return slug[:40].strip('-')


def _deduplicate_reqs(reqs: list[dict]) -> list[dict]:
    """Remove near-duplicate requirements based on title similarity."""
    seen = set()
    result = []
    for r in reqs:
        key = r["title"][:60].lower().strip()
        if key not in seen:
            seen.add(key)
            result.append(r)
    return result


def _build_traceability(reqs: list[dict], cases: list[dict]) -> dict:
    """Build requirement-to-test-case traceability matrix.

    Returns: {
        "mapping": {req_id: [case_id, ...]},
        "uncovered": [req_id, ...],
        "coverage_rate": float  # 0-100
    }
    """
    mapping = {r["id"]: [] for r in reqs}

    for req in reqs:
        req_keywords = _tokenize(req["title"] + " " + req.get("section", ""))
        if not req_keywords:
            continue

        for tc in cases:
            tc_text = " ".join([
                tc.get("title", ""),
                tc.get("module", ""),
                tc.get("expectedResult", ""),
                " ".join(tc.get("tags", [])),
            ])
            tc_keywords = _tokenize(tc_text)

            # Check covered_requirements field (explicit traceability)
            covered = tc.get("covered_requirements", [])
            if isinstance(covered, list):
                matched = False
                for cr in covered:
                    # Exact match or requirement ID suffix match (e.g. "001" matches "XXX-001")
                    if cr == req["id"] or req["id"].endswith("-" + cr) or cr.endswith("-" + req["id"].rsplit("-", 1)[-1]):
                        matched = True
                        break
                if matched:
                    mapping[req["id"]].append(tc.get("id", "?"))
                    continue

            # Keyword overlap scoring (fallback)
            # Require >= 3 common bigrams for solid match, >= 2 for short requirements
            overlap = len(req_keywords & tc_keywords)
            min_overlap = 3 if len(req_keywords) > 4 else 2
            if overlap >= min_overlap:
                mapping[req["id"]].append(tc.get("id", "?"))

    uncovered = [rid for rid, cids in mapping.items() if not cids]
    covered_count = len(reqs) - len(uncovered)
    coverage_rate = round(covered_count / max(len(reqs), 1) * 100)

    return {
        "mapping": mapping,
        "uncovered": uncovered,
        "coverage_rate": coverage_rate,
    }


def _tokenize(text: str) -> set[str]:
    """Extract meaningful tokens from text for keyword matching.

    Uses bigram tokenization for CJK text (sliding 2-char window)
    and word-level tokenization for English text.
    """
    text_lower = text.lower()
    tokens = set()

    # Extract CJK character sequences and split into bigrams
    cjk_chars = re.findall(r'[一-鿿㐀-䶿]', text_lower)
    for i in range(len(cjk_chars) - 1):
        bigram = cjk_chars[i] + cjk_chars[i + 1]
        tokens.add(bigram)

    # Extract English/ASCII words
    words = re.findall(r'[a-z0-9_]{2,}', text_lower)
    tokens.update(words)

    # Also add single CJK characters that are meaningful (not stop words)
    stop_cjk = set("的是一在了不和或也被把从到对与其为以及等")
    for ch in cjk_chars:
        if ch not in stop_cjk and len(ch) == 1:
            tokens.add(ch)

    # Filter stop words
    stop = {"the", "is", "at", "which", "on", "an", "and", "or", "but",
            "in", "with", "to", "for", "of", "from", "by", "this", "that",
            "it", "be", "as", "are", "was", "were", "been", "will", "can",
            "has", "have", "had", "not", "no", "all", "each", "every"}
    return {t for t in tokens if t not in stop and len(t) >= 2}


def _analyze_distribution(cases: list[dict]) -> dict:
    """Compute case distribution statistics."""
    modules = {}
    priorities = {"P0": 0, "P1": 0, "P2": 0, "P3": 0}
    test_types = {}
    tags = {}

    for tc in cases:
        mod = tc.get("module", "Other")
        modules[mod] = modules.get(mod, 0) + 1

        pri = tc.get("priority", "P2")
        priorities[pri] = priorities.get(pri, 0) + 1

        tt = tc.get("testDataType", "功能测试")
        test_types[tt] = test_types.get(tt, 0) + 1

        for tag in tc.get("tags", []):
            tags[tag] = tags.get(tag, 0) + 1

    return {
        "modules": modules,
        "priorities": priorities,
        "test_types": test_types,
        "tags": tags,
    }


def _identify_gaps(reqs: list[dict], traceability: dict, cases: list[dict]) -> list[dict]:
    """Identify coverage gaps with actionable recommendations."""
    gaps = []

    # Uncovered requirements
    for req in reqs:
        if req["id"] in traceability["uncovered"]:
            # Suggest priority based on keywords
            priority = _suggest_priority(req["title"])
            test_types = _suggest_test_types(req["title"])
            gaps.append({
                "type": "uncovered_requirement",
                "requirement_id": req["id"],
                "requirement_title": req["title"],
                "section": req.get("section", ""),
                "source_file": req.get("source_file", ""),
                "suggested_priority": priority,
                "suggested_test_types": test_types,
            })

    # Missing test type coverage per module
    all_types = {"功能测试", "安全测试", "边界测试", "异常测试", "性能测试"}
    mod_types = {}
    for tc in cases:
        mod = tc.get("module", "Other")
        tt = tc.get("testDataType", "功能测试")
        mod_types.setdefault(mod, set()).add(tt)

    for mod, covered_types in mod_types.items():
        missing = all_types - covered_types
        if missing:
            for mt in missing:
                gaps.append({
                    "type": "missing_test_type",
                    "module": mod,
                    "missing_type": mt,
                    "suggestion": f"模块 '{mod}' 缺少 {mt}，建议补充",
                })

    return gaps


def _suggest_priority(title: str) -> str:
    """Suggest priority based on requirement title keywords."""
    title_lower = title.lower()
    high_kw = ["登录", "支付", "auth", "login", "pay", "核心", "交易", "安全",
               "密码", "password", "权限", "删除", "delete"]
    med_kw = ["查询", "列表", "修改", "update", "search", "list", "上传", "upload"]
    if any(kw in title_lower for kw in high_kw):
        return "P0"
    if any(kw in title_lower for kw in med_kw):
        return "P1"
    return "P2"


def _suggest_test_types(title: str) -> list[str]:
    """Suggest test data types based on requirement title."""
    types = ["功能测试"]
    title_lower = title.lower()
    if any(kw in title_lower for kw in ["登录", "auth", "认证", "权限", "安全", "密码", "token"]):
        types.append("安全测试")
    if any(kw in title_lower for kw in ["查询", "搜索", "筛选", "分页", "边界", "范围", "限制"]):
        types.append("边界测试")
    if any(kw in title_lower for kw in ["超时", "异常", "错误", "失败", "并发", "不可用", "error"]):
        types.append("异常测试")
    if any(kw in title_lower for kw in ["性能", "响应时间", "qps", "并发", "吞吐"]):
        types.append("性能测试")
    return types


def _save_report(project_name: str, report: dict) -> str:
    """Save coverage report to project's reports directory."""
    reports_dir = os.path.join(PROJECT_ROOT, project_name, "reports")
    os.makedirs(reports_dir, exist_ok=True)
    report_path = os.path.join(reports_dir, "coverage.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report_path


def _load_cases(project_name: str) -> list[dict]:
    """Load test cases from project directory."""
    cases_dir = os.path.join(PROJECT_ROOT, project_name, "cases")
    for fname in ("test_cases.jsonl", "test_cases.json"):
        path = os.path.join(cases_dir, fname)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    content = f.read().strip()
                if not content:
                    return []
                if content.startswith("["):
                    data = json.loads(content)
                    return data if isinstance(data, list) else data.get("test_cases", [])
                if content.startswith("{"):
                    try:
                        data = json.loads(content)
                    except json.JSONDecodeError:
                        data = None
                    if isinstance(data, dict) and "test_cases" in data:
                        return data["test_cases"]
                    if isinstance(data, list):
                        return data
                # JSONL
                cases = []
                for line in content.split("\n"):
                    line = line.strip()
                    if line:
                        try:
                            cases.append(json.loads(line))
                        except json.JSONDecodeError:
                            pass
                return cases
            except (IOError,):
                pass
    return []


@tool(
    name="analyze_requirement_coverage",
    description="Analyze requirement-to-test-case traceability for a project. Reads spec docs and test cases, computes coverage rate, identifies gaps, and saves a structured report to projects/<name>/reports/coverage.json.",
    parameters={
        "type": "object",
        "properties": {
            "project_name": {
                "type": "string",
                "description": "Project name under projects/ directory"
            },
            "output_format": {
                "type": "string",
                "enum": ["full", "summary", "gaps_only"],
                "description": "Report detail level: full (all data), summary (stats only), gaps_only (just uncovered items)"
            },
        },
        "required": ["project_name"],
    }
)
def analyze_requirement_coverage(project_name: str, output_format: str = "full") -> str:
    project_dir = os.path.join(PROJECT_ROOT, project_name)
    if not os.path.isdir(project_dir):
        return json.dumps({"error": f"Project not found: {project_name}"}, ensure_ascii=False)

    spec_dir = os.path.join(project_dir, "spec")

    # 1. Extract requirements
    reqs = _extract_requirements(spec_dir)

    # 2. Load test cases
    cases = _load_cases(project_name)

    # 3. Build traceability
    traceability = _build_traceability(reqs, cases)

    # 4. Distribution analysis
    distribution = _analyze_distribution(cases)

    # 5. Gap identification
    gaps = _identify_gaps(reqs, traceability, cases)

    # 6. Build report
    report = {
        "project": project_name,
        "generated_at": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
        "summary": {
            "total_requirements": len(reqs),
            "total_cases": len(cases),
            "covered_requirements": len(reqs) - len(traceability["uncovered"]),
            "uncovered_requirements": len(traceability["uncovered"]),
            "coverage_rate": traceability["coverage_rate"],
            "modules_covered": len(distribution["modules"]),
        },
        "requirements": reqs if output_format != "gaps_only" else [],
        "traceability": traceability if output_format == "full" else {},
        "distribution": distribution,
        "gaps": gaps,
    }

    # 7. Save report
    report_path = _save_report(project_name, report)

    # 8. Return appropriate detail
    if output_format == "summary":
        return json.dumps(report["summary"], ensure_ascii=False, indent=2)
    if output_format == "gaps_only":
        return json.dumps({"gaps": gaps, "coverage_rate": traceability["coverage_rate"]}, ensure_ascii=False, indent=2)
    return json.dumps(report, ensure_ascii=False, indent=2)
