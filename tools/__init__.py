"""
Tools package - all agent tools live here.
"""

import json


def parse_json_arg(value):
    """Parse a tool argument that might be a JSON string or already a list/dict.

    The LLM sometimes passes objects directly instead of JSON strings.
    This handles both cases transparently.
    """
    if isinstance(value, str):
        return json.loads(value)
    return value
