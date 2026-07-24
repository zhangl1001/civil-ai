"""
Test data generation tools.
Generate boundary values, equivalence classes, faker data, and test fixtures.
"""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="generate_test_data",
    description="Generate test data values (boundary, equivalence class, exception) for a given field definition. You can pass the field list directly (no need to stringify).",
    parameters={
        "type": "object",
        "properties": {
            "field_schema": {
                "type": "string",
                "description": "JSON array of field definitions, or pass the array directly. Each field: name, type (string/number/integer/boolean/date/enum), constraints (min, max, minLength, maxLength, pattern, enum values, required)."
            },
        },
        "required": ["field_schema"],
    }
)
def generate_test_data(field_schema: str) -> str:
    try:
        fields = parse_json_arg(field_schema)
    except (json.JSONDecodeError, TypeError) as e:
        return f"Error parsing field schema: {e}"

    results = []
    for field in fields:
        name = field.get("name", "unknown")
        ftype = field.get("type", "string")
        required = field.get("required", False)
        values = _gen_for_field(name, ftype, field)
        results.append({
            "field": name,
            "type": ftype,
            "required": required,
            "test_values": values,
        })

    return json.dumps(results, ensure_ascii=False, indent=2)


def _gen_for_field(name: str, ftype: str, constraints: dict) -> list[dict]:
    """Generate test values for a single field."""
    values = []

    if ftype in ("string",):
        min_l = constraints.get("minLength", 0)
        max_l = constraints.get("maxLength", 255)
        enum_vals = constraints.get("enum")

        if enum_vals:
            for v in enum_vals:
                values.append({"category": "valid", "value": v, "expected": "accept"})
            values.append({"category": "invalid", "value": "INVALID_ENUM_VALUE", "expected": "reject"})
        else:
            normal = "A" * max(1, (min_l + max_l) // 2)
            values.append({"category": "valid", "value": normal[:max_l], "expected": "accept"})
            if min_l > 0:
                values.append({"category": "boundary", "value": "A" * min_l, "expected": "accept"})
                values.append({"category": "boundary", "value": "A" * (min_l - 1) if min_l > 1 else "", "expected": "reject"})
            values.append({"category": "boundary", "value": "A" * max_l, "expected": "accept"})
            values.append({"category": "boundary", "value": "A" * (max_l + 1), "expected": "reject"})
            values.append({"category": "invalid", "value": "", "expected": "reject" if constraints.get("required") else "accept"})

        values.append({"category": "security", "value": "'; DROP TABLE users; --", "expected": "reject/sanitize"})
        values.append({"category": "security", "value": "<script>alert(1)</script>", "expected": "reject/sanitize"})

    elif ftype in ("integer", "number"):
        min_v = constraints.get("min")
        max_v = constraints.get("max")

        if min_v is not None and max_v is not None:
            mid = (min_v + max_v) // 2 if isinstance(min_v, int) and isinstance(max_v, int) else (min_v + max_v) / 2
            values.append({"category": "valid", "value": mid, "expected": "accept"})
            values.append({"category": "boundary", "value": min_v, "expected": "accept"})
            values.append({"category": "boundary", "value": max_v, "expected": "accept"})
            values.append({"category": "boundary", "value": min_v - 1, "expected": "reject"})
            values.append({"category": "boundary", "value": max_v + 1, "expected": "reject"})
        else:
            values.append({"category": "valid", "value": 42, "expected": "accept"})
            values.append({"category": "valid", "value": 0, "expected": "accept"})
            values.append({"category": "valid", "value": -1, "expected": "accept"})
        values.append({"category": "invalid", "value": "not_a_number", "expected": "reject"})

    elif ftype == "boolean":
        values.append({"category": "valid", "value": True, "expected": "accept"})
        values.append({"category": "valid", "value": False, "expected": "accept"})
        values.append({"category": "invalid", "value": "yes", "expected": "reject"})

    elif ftype == "date":
        values.append({"category": "valid", "value": "2025-01-15", "expected": "accept"})
        values.append({"category": "boundary", "value": "2025-02-29", "expected": "depends on leap year"})
        values.append({"category": "invalid", "value": "2025-13-01", "expected": "reject"})
        values.append({"category": "invalid", "value": "not-a-date", "expected": "reject"})

    elif ftype == "email":
        values.append({"category": "valid", "value": "user@example.com", "expected": "accept"})
        values.append({"category": "invalid", "value": "not-an-email", "expected": "reject"})
        values.append({"category": "invalid", "value": "@missing-user.com", "expected": "reject"})

    else:
        values.append({"category": "valid", "value": f"sample_{ftype}_value", "expected": "accept"})

    if not constraints.get("required"):
        values.append({"category": "valid", "value": None, "expected": "accept (optional field)"})

    return values


@tool(
    name="generate_faker_data",
    description="Generate realistic Chinese test data using Faker. Specify entity type (user/profile/address/company/phone/id_card) and count.",
    parameters={
        "type": "object",
        "properties": {
            "entity": {
                "type": "string",
                "enum": ["user", "profile", "address", "company", "phone", "id_card"],
                "description": "Type of fake data to generate"
            },
            "count": {
                "type": "integer",
                "description": "Number of records to generate (max 50)"
            },
        },
        "required": ["entity"],
    }
)
def generate_faker_data(entity: str = "user", count: int = 5) -> str:
    try:
        from faker import Faker
        fake = Faker("zh_CN")
    except ImportError:
        return "Error: Faker library not installed. Run: pip install Faker"

    count = min(count, 50)
    records = []

    for _ in range(count):
        if entity == "user":
            records.append({
                "username": fake.user_name(),
                "email": fake.email(),
                "phone": fake.phone_number(),
            })
        elif entity == "profile":
            records.append({
                "name": fake.name(),
                "age": fake.random_int(18, 80),
                "gender": fake.random_element(["男", "女"]),
                "birthday": fake.date_of_birth().isoformat(),
            })
        elif entity == "address":
            records.append({
                "province": fake.province(),
                "city": fake.city(),
                "address": fake.address(),
                "zipcode": fake.postcode(),
            })
        elif entity == "company":
            records.append({
                "company": fake.company(),
                "job": fake.job(),
                "department": fake.bs(),
            })
        elif entity == "phone":
            records.append({
                "phone": fake.phone_number(),
                "imei": fake.msisdn(),
            })
        elif entity == "id_card":
            records.append({
                "id_number": fake.ssn(),
                "name": fake.name(),
            })

    return json.dumps(records, ensure_ascii=False, indent=2)


@tool(
    name="generate_fixture",
    description="Generate test fixture code (pytest or Postman format) from test case JSON.",
    parameters={
        "type": "object",
        "properties": {
            "test_cases_json": {
                "type": "string",
                "description": "JSON array of test case objects"
            },
            "format": {
                "type": "string",
                "enum": ["pytest", "postman"],
                "description": "Fixture output format"
            },
        },
        "required": ["test_cases_json"],
    }
)
def generate_fixture(test_cases_json: str, format: str = "pytest") -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except (json.JSONDecodeError, TypeError) as e:
        return f"Error parsing test cases: {e}"

    if not isinstance(cases, list):
        cases = [cases]

    if format == "pytest":
        lines = ["import pytest", "", ""]
        for tc in cases:
            tid = tc.get("id", "TC-UNKNOWN").replace("-", "_").lower()
            title = tc.get("title", "test case")
            expected = tc.get("expectedResult", "")
            lines.append(f"def test_{tid}():")
            lines.append(f'    """{title}"""')
            for step in tc.get("steps", []):
                action = step.get("action", "")
                data = step.get("data", "")
                step_expected = step.get("expected", "")
                lines.append(f"    # {action}")
                if data:
                    lines.append(f"    data = {json.dumps(data)}")
                if step_expected:
                    lines.append(f"    # Expected: {step_expected}")
            lines.append(f"    assert True  # TODO: verify: {expected}")
            lines.append("")
        return "\n".join(lines)

    elif format == "postman":
        items = []
        for tc in cases:
            items.append({
                "name": tc.get("title", "test"),
                "request": {
                    "method": "GET",
                    "url": tc.get("module", ""),
                    "description": tc.get("expectedResult", ""),
                }
            })
        collection = {
            "info": {"name": "Generated Tests", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
            "item": items,
        }
        return json.dumps(collection, ensure_ascii=False, indent=2)

    return f"Unknown format: {format}"
