"""
XMind export tool - generates .xmind mind map files.
XMind format is ZIP + XML, no external dependency needed.
"""

import json
import os
import uuid
import zipfile
from agent.tool_registry import tool
from tools import parse_json_arg


def _xm_id():
    return str(uuid.uuid4()).replace("-", "")


def _xm_escape(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("\n", "&#xa;")


# Style definitions mapped to style IDs in styles.xml
_TOPIC_STYLES = {
    "module": "module",
    "priority-P0": "priority-P0",
    "priority-P1": "priority-P1",
    "priority-P2": "priority-P2",
    "priority-P3": "priority-P3",
    "case": "case",
    "detail": "detail",
    "root": "root",
}


def _build_topic(title: str, children: list = None, folded: bool = False, style_id: str = None) -> str:
    """Build a single XMind topic XML element with style-id reference."""
    tid = _xm_id()
    attr = f'id="{tid}" modified-by="zhangl-agent" timestamp="{int(__import__("time").time() * 1000)}"'
    if folded and style_id != "root":
        attr += ' branch="folded"'
    style_key = style_id or ""
    if style_key in _TOPIC_STYLES:
        attr += f' style-id="{_TOPIC_STYLES[style_key]}"'

    inner = f"<title>{_xm_escape(str(title))}</title>"
    if children:
        inner += "<children><topics type=\"attached\">"
        for child_el in children:
            inner += child_el
        inner += "</topics></children>"

    return f"<topic {attr}>{inner}</topic>"


def _build_content_xml(cases: list, title: str = "Test Cases") -> str:
    """Build the content.xml for XMind."""
    # Group cases by module → priority
    modules: dict[str, dict[str, list[dict]]] = {}
    for tc in cases:
        mod = tc.get("module", "Other")
        pri = tc.get("priority", "P2")
        modules.setdefault(mod, {}).setdefault(pri, []).append(tc)

    # Build module topics
    module_topics = []
    for mod_name, priorities in modules.items():
        # Module → Priority → Test cases
        priority_topics = []
        for pri in ["P0", "P1", "P2", "P3"]:
            cases_in_pri = priorities.get(pri, [])
            if not cases_in_pri:
                continue
            # Priority → Cases
            case_topics = []
            for tc in cases_in_pri:
                # Build case detail
                case_lines = [tc.get("title", "Untitled")]
                steps = tc.get("steps", [])
                for s in (steps[:3] if len(steps) > 3 else steps):
                    if isinstance(s, dict):
                        case_lines.append(f"Step{s.get('step','?')}: {s.get('action','')[:50]}")
                expected = tc.get("expectedResult", "")
                if expected:
                    case_lines.append(f"Expected: {expected[:60]}")

                # Case topic with detail
                detail_topics = []
                for line in case_lines[1:]:
                    detail_topics.append(_build_topic(line, style_id="detail"))

                case_topics.append(_build_topic(case_lines[0], detail_topics, style_id="case"))

            priority_topics.append(_build_topic(
                f"[{pri}] {len(cases_in_pri)} cases", case_topics,
                folded=len(cases_in_pri) > 15,
                style_id=f"priority-{pri}"
            ))

        module_topics.append(_build_topic(
            f"{mod_name} ({sum(len(v) for v in priorities.values())} cases)",
            priority_topics, style_id="module"
        ))

    total = len(cases)
    stats_topics = [
        _build_topic(f"Total: {total} cases"),
        _build_topic(f"P0: {sum(1 for tc in cases if tc.get('priority')=='P0')} | P1: {sum(1 for tc in cases if tc.get('priority')=='P1')} | P2: {sum(1 for tc in cases if tc.get('priority')=='P2')} | P3: {sum(1 for tc in cases if tc.get('priority')=='P3')}"),
    ]

    root = _build_topic(title, module_topics, style_id="root")

    return f"""<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" version="2.0" theme-id="zhangl-theme">
<sheet id="{_xm_id()}" modified-by="zhangl-agent" timestamp="{int(__import__('time').time() * 1000)}">
{root}
</sheet>
</xmap-content>"""


def _build_manifest_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<manifest xmlns="urn:xmind:xmap:xmlns:manifest:1.0">
<file-entry full-path="content.xml" media-type="text/xml"/>
<file-entry full-path="styles.xml" media-type="text/xml"/>
<file-entry full-path="theme.json" media-type="application/json"/>
<file-entry full-path="META-INF/" media-type=""/>
<file-entry full-path="META-INF/manifest.xml" media-type="text/xml"/>
</manifest>"""


def _build_theme_json() -> str:
    return json.dumps({
        "id": "zhangl-theme",
        "name": "Zhangl Theme",
        "cssRules": [
            {
                "selector": "topic[style-id=root]",
                "style": {
                    "svg:fill": "#1e293b",
                    "line-color": "#0f172a",
                    "border-line-color": "#0f172a",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "16px",
                    "fo:font-weight": "bold",
                    "fo:color": "#ffffff",
                },
            },
            {
                "selector": "topic[style-id=module]",
                "style": {
                    "svg:fill": "#3b82f6",
                    "line-color": "#2563eb",
                    "border-line-color": "#2563eb",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "14px",
                    "fo:font-weight": "bold",
                    "fo:color": "#ffffff",
                },
            },
            {
                "selector": "topic[style-id=priority-P0]",
                "style": {
                    "svg:fill": "#fecaca",
                    "line-color": "#dc2626",
                    "border-line-color": "#dc2626",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "12px",
                    "fo:font-weight": "bold",
                    "fo:color": "#b91c1c",
                },
            },
            {
                "selector": "topic[style-id=priority-P1]",
                "style": {
                    "svg:fill": "#fed7aa",
                    "line-color": "#ea580c",
                    "border-line-color": "#ea580c",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "12px",
                    "fo:font-weight": "bold",
                    "fo:color": "#c2410c",
                },
            },
            {
                "selector": "topic[style-id=priority-P2]",
                "style": {
                    "svg:fill": "#fef08a",
                    "line-color": "#ca8a04",
                    "border-line-color": "#ca8a04",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "12px",
                    "fo:color": "#a16207",
                },
            },
            {
                "selector": "topic[style-id=priority-P3]",
                "style": {
                    "svg:fill": "#bbf7d0",
                    "line-color": "#16a34a",
                    "border-line-color": "#16a34a",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "12px",
                    "fo:color": "#15803d",
                },
            },
            {
                "selector": "topic[style-id=case]",
                "style": {
                    "svg:fill": "#ffffff",
                    "line-color": "#d1d5db",
                    "border-line-color": "#d1d5db",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "11px",
                    "fo:color": "#374151",
                },
            },
            {
                "selector": "topic[style-id=detail]",
                "style": {
                    "svg:fill": "#f9fafb",
                    "line-color": "#e5e7eb",
                    "border-line-color": "#e5e7eb",
                    "shape-class": "org.xmind.topicShape.roundedRect",
                    "fo:font-family": "PingFang SC,Microsoft YaHei,sans-serif",
                    "fo:font-size": "10px",
                    "fo:color": "#6b7280",
                },
            },
        ],
    }, ensure_ascii=False, indent=2)


def _build_styles_xml() -> str:
    return """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<xmap-styles xmlns="urn:xmind:xmap:xmlns:style:2.0" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:svg="http://www.w3.org/2000/svg" version="2.0">
<theme id="zhangl-theme" name="Zhangl Theme">
<map>
<style id="root" type="topic" name="Root">
<properties>
<svg:fill>#1e293b</svg:fill>
<line-color>#0f172a</line-color>
<border-line-color>#0f172a</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="16" color="#ffffff" font-weight="bold"/>
</properties>
</style>
<style id="module" type="topic" name="Module">
<properties>
<svg:fill>#3b82f6</svg:fill>
<line-color>#2563eb</line-color>
<border-line-color>#2563eb</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="14" color="#ffffff" font-weight="bold"/>
</properties>
</style>
<style id="priority-P0" type="topic" name="P0 Critical">
<properties>
<svg:fill>#fecaca</svg:fill>
<line-color>#dc2626</line-color>
<border-line-color>#dc2626</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="12" color="#b91c1c" font-weight="bold"/>
</properties>
</style>
<style id="priority-P1" type="topic" name="P1 High">
<properties>
<svg:fill>#fed7aa</svg:fill>
<line-color>#ea580c</line-color>
<border-line-color>#ea580c</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="12" color="#c2410c" font-weight="bold"/>
</properties>
</style>
<style id="priority-P2" type="topic" name="P2 Medium">
<properties>
<svg:fill>#fef08a</svg:fill>
<line-color>#ca8a04</line-color>
<border-line-color>#ca8a04</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="12" color="#a16207"/>
</properties>
</style>
<style id="priority-P3" type="topic" name="P3 Low">
<properties>
<svg:fill>#bbf7d0</svg:fill>
<line-color>#16a34a</line-color>
<border-line-color>#16a34a</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="12" color="#15803d"/>
</properties>
</style>
<style id="case" type="topic" name="Case">
<properties>
<svg:fill>#ffffff</svg:fill>
<line-color>#d1d5db</line-color>
<border-line-color>#d1d5db</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="11" color="#374151"/>
</properties>
</style>
<style id="detail" type="topic" name="Detail">
<properties>
<svg:fill>#f9fafb</svg:fill>
<line-color>#e5e7eb</line-color>
<border-line-color>#e5e7eb</border-line-color>
<shape-class>org.xmind.topicShape.roundedRect</shape-class>
<fo:font family="PingFang SC,Microsoft YaHei,sans-serif" size="10" color="#6b7280"/>
</properties>
</style>
</map>
</theme>
</xmap-styles>"""


@tool(
    name="export_xmind",
    description="Export structured data to XMind mind map format (.xmind). Organizes items by module → category → title, with details as subtopics.",
    parameters={
        "type": "object",
        "properties": {
            "test_cases_json": {
                "type": "string",
                "description": "JSON array of test case objects"
            },
            "path": {
                "type": "string",
                "description": "Output file path (e.g. projects/<name>/cases/test_cases.xmind)"
            },
            "title": {
                "type": "string",
                "description": "Root topic title"
            },
        },
        "required": ["test_cases_json", "path"],
    },
    category="output",
)
def export_xmind(test_cases_json: str, path: str, title: str = "Mind Map") -> str:
    try:
        cases = parse_json_arg(test_cases_json)
    except json.JSONDecodeError as e:
        return f"Error parsing test cases: {e}"

    # Handle wrapped format: {export_info: ..., test_cases: [...]}
    if isinstance(cases, dict) and "test_cases" in cases:
        cases = cases["test_cases"]

    if not isinstance(cases, list):
        cases = [cases]

    content_xml = _build_content_xml(cases, title)
    manifest_xml = _build_manifest_xml()
    styles_xml = _build_styles_xml()
    theme_json = _build_theme_json()

    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("content.xml", content_xml)
        zf.writestr("META-INF/manifest.xml", manifest_xml)
        zf.writestr("styles.xml", styles_xml)
        zf.writestr("theme.json", theme_json)

    # Count modules
    modules = set(tc.get("module", "Other") for tc in cases)
    return f"Exported {len(cases)} items in {len(modules)} modules to {path}"
