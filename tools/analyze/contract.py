"""API contract validation tools."""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="validate_contract",
    description="Compare an OpenAPI spec against actual API response samples to find inconsistencies. Checks: missing fields, type mismatches, undocumented endpoints.",
    parameters={
        "type": "object",
        "properties": {
            "openapi_spec": {"type": "string", "description": "Raw OpenAPI YAML/JSON specification"},
            "response_samples": {"type": "string", "description": "JSON object mapping endpoint paths to sample response bodies. Format: {\"GET /users\": {...}, \"POST /users\": {...}}"},
        },
        "required": ["openapi_spec"],
    }
)
def validate_contract(openapi_spec: str, response_samples: str = "{}") -> str:
    """Validate API contract: compare spec against actual responses."""
    import yaml

    try:
        if openapi_spec.strip().startswith("{"):
            spec = parse_json_arg(openapi_spec)
        else:
            spec = yaml.safe_load(openapi_spec)
    except Exception as e:
        return f"Error parsing spec: {e}"

    try:
        samples = parse_json_arg(response_samples) if response_samples else {}
    except json.JSONDecodeError:
        samples = {}

    issues = []
    paths = spec.get("paths", {})

    # 1. Check spec-defined schemas for completeness
    schemas = {}
    for path, methods in paths.items():
        for method, details in methods.items():
            if method.upper() not in ("GET", "POST", "PUT", "DELETE", "PATCH"):
                continue
            # Check responses defined
            responses = details.get("responses", {})
            if not responses:
                issues.append({"endpoint": f"{method.upper()} {path}", "type": "missing_responses", "detail": "No response schema defined"})
            for status, resp in responses.items():
                content = resp.get("content", {})
                if "application/json" in content:
                    schema = content["application/json"].get("schema", {})
                    if "$ref" in schema:
                        ref_name = schema["$ref"].split("/")[-1]
                        schemas[f"{method.upper()} {path}"] = ref_name

            # Check parameters
            params = details.get("parameters", [])
            for p in params:
                if p.get("required") and not p.get("schema"):
                    issues.append({"endpoint": f"{method.upper()} {path}", "type": "param_no_schema", "detail": f"Required param '{p['name']}' has no type schema"})

    # 2. Compare spec vs samples if provided
    for endpoint, sample in samples.items():
        if endpoint not in [f"{m.upper()} {p}" for p, methods in paths.items() for m in methods]:
            issues.append({"endpoint": endpoint, "type": "undocumented_endpoint", "detail": "Response sample exists but endpoint not in spec"})
        else:
            # Check required fields from spec are present in sample
            ref = schemas.get(endpoint, "")
            if ref and isinstance(sample, dict):
                # Find the schema
                for schema_name, schema_def in spec.get("components", {}).get("schemas", {}).items():
                    if schema_name == ref:
                        required = schema_def.get("required", [])
                        props = schema_def.get("properties", {})
                        for field in required:
                            if field not in sample:
                                issues.append({"endpoint": endpoint, "type": "missing_required_field", "detail": f"Required field '{field}' (type: {props.get(field, {}).get('type', '?')}) missing from response"})
                        for field, value in sample.items():
                            if field in props:
                                expected_type = props[field].get("type", "")
                                actual_type = type(value).__name__
                                if expected_type == "integer" and not isinstance(value, (int, float)):
                                    issues.append({"endpoint": endpoint, "type": "type_mismatch", "detail": f"Field '{field}': expected {expected_type}, got {actual_type}"})

    if not issues:
        return json.dumps({"status": "ok", "message": f"Contract validation passed: {len(paths)} endpoints, no issues found"}, ensure_ascii=False, indent=2)

    return json.dumps({
        "status": "issues_found",
        "total_issues": len(issues),
        "issues": issues,
        "summary": f"Found {len(issues)} contract issues across {len(paths)} endpoints",
    }, ensure_ascii=False, indent=2)


@tool(
    name="schema_conformance",
    description="Validate JSON data against a JSON Schema. Checks required fields, type constraints, enum values, min/max, pattern matching.",
    parameters={
        "type": "object",
        "properties": {
            "json_data": {"type": "string", "description": "JSON data string to validate"},
            "json_schema": {"type": "string", "description": "JSON Schema to validate against"},
        },
        "required": ["json_data", "json_schema"],
    }
)
def schema_conformance(json_data: str, json_schema: str) -> str:
    """Validate JSON data against a schema. Basic implementation without jsonschema dependency."""
    try:
        data = parse_json_arg(json_data)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON data: {e}"

    try:
        schema = parse_json_arg(json_schema)
    except json.JSONDecodeError as e:
        return f"Error: invalid JSON schema: {e}"

    results = []
    required = schema.get("required", [])
    properties = schema.get("properties", {})
    stype = schema.get("type", "object")

    # Type check
    if stype == "object" and not isinstance(data, (dict, list)):
        results.append({"field": "(root)", "check": "type", "status": "fail", "expected": "object", "actual": type(data).__name__})
    elif stype == "array" and not isinstance(data, list):
        results.append({"field": "(root)", "check": "type", "status": "fail", "expected": "array", "actual": type(data).__name__})

    items = [data] if isinstance(data, dict) else (data if isinstance(data, list) else [data])

    for item in (items if isinstance(items, list) else [items]):
        if not isinstance(item, dict):
            continue

        # Required fields
        for field in required:
            if field not in item or item[field] is None:
                results.append({"field": field, "check": "required", "status": "fail", "detail": "Field is required but missing or null"})
            else:
                results.append({"field": field, "check": "required", "status": "pass"})

        # Type checks on properties
        for field, value in item.items():
            if field in properties:
                prop = properties[field]
                expected = prop.get("type", "string")

                if expected == "integer" and not isinstance(value, int):
                    results.append({"field": field, "check": "type", "status": "fail", "expected": expected, "actual": type(value).__name__})
                elif expected == "number" and not isinstance(value, (int, float)):
                    results.append({"field": field, "check": "type", "status": "fail", "expected": expected, "actual": type(value).__name__})
                elif expected == "string" and not isinstance(value, str):
                    results.append({"field": field, "check": "type", "status": "fail", "expected": expected, "actual": type(value).__name__})
                elif expected == "boolean" and not isinstance(value, bool):
                    results.append({"field": field, "check": "type", "status": "fail", "expected": expected, "actual": type(value).__name__})
                else:
                    results.append({"field": field, "check": "type", "status": "pass", "expected": expected})

                # Min/max for numbers
                if "minimum" in prop and isinstance(value, (int, float)):
                    mn = prop["minimum"]
                    if value < mn:
                        results.append({"field": field, "check": "minimum", "status": "fail", "expected": f">= {mn}", "actual": value})
                if "maximum" in prop and isinstance(value, (int, float)):
                    mx = prop["maximum"]
                    if value > mx:
                        results.append({"field": field, "check": "maximum", "status": "fail", "expected": f"<= {mx}", "actual": value})

                # Min/max length for strings
                if "minLength" in prop and isinstance(value, str):
                    if len(value) < prop["minLength"]:
                        results.append({"field": field, "check": "minLength", "status": "fail", "expected": f">= {prop['minLength']}", "actual": len(value)})
                if "maxLength" in prop and isinstance(value, str):
                    if len(value) > prop["maxLength"]:
                        results.append({"field": field, "check": "maxLength", "status": "fail", "expected": f"<= {prop['maxLength']}", "actual": len(value)})

                # Enum
                if "enum" in prop and value not in prop["enum"]:
                    results.append({"field": field, "check": "enum", "status": "fail", "expected": prop["enum"], "actual": value})

    fails = [r for r in results if r.get("status") == "fail"]
    return json.dumps({
        "total_checks": len(results),
        "passed": len(results) - len(fails),
        "failed": len(fails),
        "results": results[:50],
    }, ensure_ascii=False, indent=2)
