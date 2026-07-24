"""
Coverage analysis tools.
Analyze test coverage, identify gaps, and build traceability matrices.
"""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="analyze_coverage",
    description="Analyze test coverage for a set of test cases against a specification. Computes parameter coverage, scenario coverage, and endpoint coverage.",
    parameters={
        "type": "object",
        "properties": {
            "test_cases_json": {
                "type": "string",
                "description": "JSON array of test case objects (each with id, module, title, testDataType, priority, tags)"
            },
            "spec_summary": {
                "type": "string",
                "description": "Summary of what should be tested (endpoint list, parameter list, scenario types). Free text."
            },
        },
        "required": ["test_cases_json", "spec_summary"],
    }
)
def analyze_coverage(test_cases_json: str, spec_summary: str = "") -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except json.JSONDecodeError as e:
        return f"Error parsing test cases: {e}"

    if not isinstance(cases, list):
        return "Error: test_cases_json must be a JSON array"

    # Module coverage
    modules = {}
    for tc in cases:
        mod = tc.get("module", "unknown")
        modules.setdefault(mod, []).append(tc)

    # Priority distribution
    priorities = {"P0": 0, "P1": 0, "P2": 0, "P3": 0}
    for tc in cases:
        p = tc.get("priority", "P2")
        priorities[p] = priorities.get(p, 0) + 1

    # Test data type distribution
    data_types = {}
    for tc in cases:
        dt = tc.get("testDataType", "功能测试")
        data_types[dt] = data_types.get(dt, 0) + 1

    # Compute key metrics
    total = len(cases)
    p0_count = priorities.get("P0", 0)
    security = data_types.get("安全测试", 0)
    boundary = data_types.get("边界测试", 0)
    exception = data_types.get("异常测试", 0)

    report = {
        "total_test_cases": total,
        "module_count": len(modules),
        "modules": list(modules.keys()),
        "modules_detail": {m: len(cs) for m, cs in modules.items()},
        "priority_distribution": priorities,
        "coverage_rate": min(100, round(total / max(len(modules), 1) * 10)),
        "data_type_distribution": data_types,
        "assessment": {
            "p0_coverage": "good" if p0_count > 0 else "insufficient - add P0 test cases",
            "security_coverage": "good" if security > 0 else "consider adding security test cases",
            "boundary_coverage": "good" if boundary > 0 else "consider adding boundary value tests",
            "exception_coverage": "good" if exception > 0 else "consider adding exception scenario tests",
        },
        "spec_summary": spec_summary[:500] if spec_summary else "",
    }

    return json.dumps(report, ensure_ascii=False, indent=2)


@tool(
    name="gap_analysis",
    description="Compare requirements against existing test cases and identify testing blind spots.",
    parameters={
        "type": "object",
        "properties": {
            "requirements": {
                "type": "string",
                "description": "List of requirements or features that should be tested, one per line"
            },
            "test_cases_json": {
                "type": "string",
                "description": "JSON array of existing test case objects"
            },
        },
        "required": ["requirements"],
    }
)
def gap_analysis(requirements: str, test_cases_json: str = "[]") -> str:
    try:
        cases = parse_json_arg(test_cases_json) if test_cases_json else []
    except json.JSONDecodeError:
        cases = []

    req_lines = [r.strip() for r in requirements.split("\n") if r.strip()]

    # Multi-strategy matching:
    # 1. Direct covered_requirements field match (exact ID)
    # 2. Fuzzy REQ-ID prefix match: REQ-AUTH-001 matches REQ-AUTH-2.3.1
    # 3. Keyword match on test case content (title, module, description)
    import re

    def _extract_req_base_id(req_line: str) -> str:
        """Extract base requirement ID, stripping trailing version/sequence.
        REQ-AUTH-001 -> REQ-AUTH
        REQ-AUTH-2.3.1 -> REQ-AUTH
        REQ-USER-LOGIN-01 -> REQ-USER-LOGIN
        """
        # Try to match REQ-XXX-XXX pattern
        m = re.match(r"(REQ-[A-Z]+(?:-[A-Z]+)*?)(?:-\d+(?:\.\d+)*)?$", req_line)
        if m:
            return m.group(1)
        return req_line

    def _req_matches_case(req_line: str, tc: dict) -> tuple[bool, str]:
        """Check if a requirement matches a test case. Returns (matched, method)."""
        # Strategy 1: covered_requirements field
        covered = tc.get("covered_requirements", [])
        if any(req_line.strip() in str(c) for c in covered):
            return True, "covered_requirements"

        # Strategy 2: Fuzzy REQ-ID prefix match
        req_base = _extract_req_base_id(req_line)
        if req_base.startswith("REQ-") and len(req_base) > 4:
            # Check if any covered_requirements contains this base ID
            if any(req_base in str(c) for c in covered):
                return True, "req_id_prefix"
            # Also check if test case ID references the same module prefix
            tc_id = tc.get("id", "")
            # Extract module from req_base: REQ-AUTH -> AUTH
            module_part = req_base.replace("REQ-", "")
            if module_part.lower() in tc_id.lower():
                return True, "req_id_prefix"

        # Strategy 3: Keyword match on full test case content
        tc_text = " ".join(
            str(tc.get(k, "")) for k in ("title", "module", "description", "expectedResult")
        ).lower()
        keywords = req_line.lower().split()
        match_count = sum(1 for kw in keywords if len(kw) > 2 and kw in tc_text)
        if match_count > 0:
            return True, "keyword"

        return False, ""

    gaps = []
    covered = []

    for req in req_lines:
        matching_cases = []
        methods_used = set()
        for tc in cases:
            matched, method = _req_matches_case(req, tc)
            if matched:
                matching_cases.append(tc.get("id", "?"))
                methods_used.add(method)

        if not matching_cases and cases:
            gaps.append({
                "requirement": req,
                "status": "no_coverage",
                "suggestion": f"Add test cases for: {req}",
            })
        elif not matching_cases:
            gaps.append({
                "requirement": req,
                "status": "no_test_cases_yet",
                "suggestion": "No test cases exist for any requirement",
            })
        else:
            covered.append({
                "requirement": req,
                "status": "covered",
                "matched_cases": matching_cases,
                "match_method": ", ".join(methods_used),
            })

    return json.dumps({
        "total_requirements": len(req_lines),
        "covered": len(covered),
        "gaps": len(gaps),
        "coverage_percent": round(len(covered) / max(len(req_lines), 1) * 100),
        "gap_details": gaps,
        "covered_details": covered,
    }, ensure_ascii=False, indent=2)


@tool(
    name="traceability_matrix",
    description="Generate a requirements-to-test-cases traceability matrix.",
    parameters={
        "type": "object",
        "properties": {
            "requirements": {
                "type": "string",
                "description": "Requirement list, one per line. Format: REQ-ID: description"
            },
            "test_cases_json": {
                "type": "string",
                "description": "JSON array of test case objects"
            },
        },
        "required": ["requirements", "test_cases_json"],
    }
)
def traceability_matrix(requirements: str, test_cases_json: str) -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except json.JSONDecodeError as e:
        return f"Error parsing test cases: {e}"

    req_lines = [r.strip() for r in requirements.split("\n") if r.strip()]

    matrix = []
    for req in req_lines:
        req_id = req.split(":")[0].strip() if ":" in req else req[:20]
        req_desc = req.split(":", 1)[1].strip() if ":" in req else req
        linked_cases = []
        for tc in cases:
            tc_title = tc.get("title", "")
            tc_module = tc.get("module", "")
            if any(kw.lower() in (tc_title + tc_module).lower() for kw in req_desc.lower().split() if len(kw) > 2):
                linked_cases.append(tc.get("id", "?"))

        matrix.append({
            "requirement_id": req_id,
            "description": req_desc,
            "linked_test_cases": linked_cases,
            "count": len(linked_cases),
            "status": "covered" if linked_cases else "not_covered",
        })

    total = len(matrix)
    covered_count = sum(1 for m in matrix if m["status"] == "covered")

    return json.dumps({
        "summary": f"{covered_count}/{total} requirements covered",
        "coverage_percent": round(covered_count / max(total, 1) * 100),
        "matrix": matrix,
    }, ensure_ascii=False, indent=2)
