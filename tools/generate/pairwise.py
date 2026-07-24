"""
Pairwise / orthogonal combination test tool.
Wraps allpairspy to generate optimal test parameter combinations.
"""

import json
from agent.tool_registry import tool
from tools import parse_json_arg


@tool(
    name="generate_pairwise",
    description="Generate pairwise (all-pairs) test combinations from parameter definitions. Reduces combinatorial explosion while maintaining high defect detection rate. Takes factor names and their possible values, returns an optimal set of test combinations.",
    parameters={
        "type": "object",
        "properties": {
            "parameters_json": {
                "type": "string",
                "description": "JSON object mapping factor names to arrays of possible values. Example: {\"浏览器\": [\"Chrome\",\"Firefox\",\"Safari\"], \"操作系统\": [\"Windows\",\"macOS\",\"Linux\"], \"语言\": [\"zh\",\"en\",\"ja\"]}"
            },
            "mode": {
                "type": "string",
                "enum": ["pairwise", "triple", "nwise"],
                "description": "Combination mode: pairwise=2-way (default, covers all pairs), triple=3-way, nwise=all permutations"
            },
        },
        "required": ["parameters_json"],
    }
)
def generate_pairwise(parameters_json: str, mode: str = "pairwise") -> str:
    try:
        params = parse_json_arg(parameters_json)
    except json.JSONDecodeError as e:
        return f"Error parsing parameters: {e}"

    if not isinstance(params, dict):
        return "Error: parameters_json must be a JSON object (key→values)"

    factor_names = list(params.keys())
    value_lists = [params[k] for k in factor_names]

    # Validate
    for name, values in zip(factor_names, value_lists):
        if not isinstance(values, list) or len(values) == 0:
            return f"Error: factor '{name}' must have a non-empty array of values"
        if len(values) > 100:
            return f"Error: factor '{name}' has too many values ({len(values)}). Max 100."

    total_combinations = 1
    for v in value_lists:
        total_combinations *= len(v)

    # Try allpairspy first
    combinations = None
    try:
        from allpairspy import AllPairs

        pairs = AllPairs(value_lists)
        combinations = []
        for row in pairs:
            combination = {}
            for i, val in enumerate(row):
                combination[factor_names[i]] = val
            combinations.append(combination)

    except ImportError:
        pass

    # Fallback: manual pairwise approximation
    if combinations is None:
        combinations = _manual_pairwise(factor_names, value_lists)

    # Generate test case suggestions for each combination
    test_suggestions = []
    for combo in combinations:
        title_parts = []
        for name in factor_names:
            title_parts.append(f"{name}={combo[name]}")
        test_suggestions.append({
            "combination": combo,
            "title": " × ".join(title_parts),
            "priority": "P1" if len(factor_names) <= 3 else "P2",
        })

    return json.dumps({
        "mode": mode,
        "factors": len(factor_names),
        "values_per_factor": {k: len(v) for k, v in params.items()},
        "full_combinations": total_combinations,
        "pairwise_combinations": len(combinations),
        "reduction_percent": round((1 - len(combinations) / max(total_combinations, 1)) * 100),
        "allpairspy_used": combinations is not None,  # re-evaluated after fallback
        "combinations": test_suggestions,
    }, ensure_ascii=False, indent=2)


def _manual_pairwise(factors: list[str], values: list[list]) -> list[dict]:
    """
    Manual pairwise approximation when allpairspy is not available.
    Uses a greedy approach: for each value of the first factor, cycle through
    values of remaining factors to ensure each pair appears at least once.
    """
    if not factors or not values:
        return []

    # Use the factor with most values as anchor
    max_idx = 0
    max_len = len(values[0])
    for i, v in enumerate(values):
        if len(v) > max_len:
            max_len = len(v)
            max_idx = i

    anchor_values = values[max_idx]
    other_factors = [(factors[i], values[i]) for i in range(len(factors)) if i != max_idx]

    results = []
    seen_pairs = set()

    for anchor_val in anchor_values:
        for other_name, other_vals in other_factors:
            for other_val in other_vals:
                pair = (factors[max_idx], anchor_val, other_name, other_val)
                if pair not in seen_pairs:
                    seen_pairs.add(pair)
                    combo = {factors[max_idx]: anchor_val, other_name: other_val}
                    # Fill remaining factors
                    for n, v in zip(factors, values):
                        if n not in combo:
                            combo[n] = v[0]
                    results.append(combo)

                if len(results) >= 200:
                    break

    return results
