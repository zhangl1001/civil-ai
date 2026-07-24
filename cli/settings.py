"""
Unified settings system.
Loads from ~/.zhangl-agent/settings.json (user-level)
and .zhangl-agent/settings.json (project-level, overrides user).

On Windows, uses %APPDATA%/zhangl-agent/ (standard config location).
Migrates from old ~/.zhangl-agent/ automatically.
"""

import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from typing import Optional


def get_user_dir() -> str:
    """Unified user data directory: ~/.zhangl-agent/ (or %APPDATA%/zhangl-agent on Windows)."""
    if sys.platform == "win32":
        return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "zhangl-agent")
    return os.path.expanduser("~/.zhangl-agent")

# Backward compat alias
_get_settings_dir = get_user_dir


def _migrate_old_settings():
    """Migrate from old ~/.zhangl-agent/ to platform-appropriate dir."""
    old_dir = os.path.expanduser("~/.zhangl-agent")
    new_dir = _get_settings_dir()
    old_file = os.path.join(old_dir, "settings.json")
    new_file = os.path.join(new_dir, "settings.json")

    if old_dir == new_dir:
        return
    if not os.path.isfile(old_file):
        return
    if os.path.isfile(new_file):
        return  # already migrated

    os.makedirs(new_dir, exist_ok=True)
    try:
        shutil.copy2(old_file, new_file)
    except OSError:
        pass  # keep using old location on failure


_migrate_old_settings()

SETTINGS_DIR = _get_settings_dir()
SETTINGS_FILE = os.path.join(SETTINGS_DIR, "settings.json")


# --- Data classes ---

@dataclass
class ModelSettings:
    model_provider: str = "openai"
    base_url: str = ""
    auth_token: str = ""
    default_model: str = "deepseek-v4-flash"
    default_model_max_tokens: int = 32768
    smart_model: str = ""
    smart_model_max_tokens: int = 32768
    small_model: str = ""
    small_model_max_tokens: int = 32768
    expert_thinking_turns: int = 2   # 专家子agent保留最近N轮thinking（0=保留全部）


@dataclass
class PermissionSettings:
    allow: list[str] = field(default_factory=list)
    deny: list[str] = field(default_factory=list)
    ask_before: list[str] = field(default_factory=list)  # write outside project, network calls


@dataclass
class MemorySettings:
    enabled: bool = True
    storage_dir: str = ""
    auto_remember: bool = True


@dataclass
class ExportFormat:
    enabled: bool = True
    template: str = ""


@dataclass
class ExportSettings:
    default_format: str = "json"
    default_dir: str = "./test_cases"
    formats: dict[str, ExportFormat] = field(default_factory=lambda: {
        "json": ExportFormat(enabled=True),
        "excel": ExportFormat(enabled=True),
        "markdown": ExportFormat(enabled=False),
        "testrail_csv": ExportFormat(enabled=False),
    })


@dataclass
class StatusLineSettings:
    type: str = "default"
    items: list[str] = field(default_factory=lambda: ["model", "provider", "tokens"])


@dataclass
class UISettings:
    theme: str = "dark"
    dialog_style: str = "panel"


@dataclass
class Settings:
    model: ModelSettings = field(default_factory=ModelSettings)
    permissions: PermissionSettings = field(default_factory=PermissionSettings)
    memory: MemorySettings = field(default_factory=MemorySettings)
    export: ExportSettings = field(default_factory=ExportSettings)
    status_line: StatusLineSettings = field(default_factory=StatusLineSettings)
    ui: UISettings = field(default_factory=UISettings)


# --- Default settings ---

DEFAULT_SETTINGS = Settings()


def _dict_to_settings(d: dict) -> Settings:
    """Convert raw dict to Settings."""
    s = Settings()

    mc = d.get("model", {})
    s.model = ModelSettings(
        model_provider=mc.get("MODEL_PROVIDER", ""),
        base_url=mc.get("ZHANGL_BASE_URL", ""),
        auth_token=mc.get("ZHANGL_AUTH_TOKEN", ""),
        default_model=mc.get("DEFAULT_MODEL", "deepseek-v4-flash"),
        default_model_max_tokens=mc.get("DEFAULT_MODEL_MAX_TOKENS", 32768),
        smart_model=mc.get("SMART_MODEL", ""),
        smart_model_max_tokens=mc.get("SMART_MODEL_MAX_TOKENS", 32768),
        small_model=mc.get("SMALL_MODEL", ""),
        small_model_max_tokens=mc.get("SMALL_MODEL_MAX_TOKENS", 32768),
        expert_thinking_turns=mc.get("EXPERT_THINKING_TURNS", 2),
    )

    perm = d.get("permissions", {})
    s.permissions = PermissionSettings(
        allow=perm.get("allow", []),
        deny=perm.get("deny", []),
        ask_before=perm.get("ask_before", []),
    )

    mem = d.get("memory", {})
    s.memory = MemorySettings(
        enabled=mem.get("enabled", True),
        storage_dir=mem.get("storage_dir", ""),
        auto_remember=mem.get("auto_remember", True),
    )

    exp = d.get("export", {})
    exp_formats = {}
    for fmt_name, fmt_data in exp.get("formats", {}).items():
        exp_formats[fmt_name] = ExportFormat(
            enabled=fmt_data.get("enabled", True),
            template=fmt_data.get("template", ""),
        )
    s.export = ExportSettings(
        default_format=exp.get("default_format", "json"),
        default_dir=exp.get("default_dir", "./test_cases"),
        formats=exp_formats or DEFAULT_SETTINGS.export.formats,
    )

    sl = d.get("status_line", {})
    s.status_line = StatusLineSettings(
        type=sl.get("type", "default"),
        items=sl.get("items", ["model", "provider", "tokens"]),
    )

    ui = d.get("ui", {})
    s.ui = UISettings(
        theme=ui.get("theme", "dark"),
        dialog_style=ui.get("dialog_style", "panel"),
    )

    return s


def load_settings(project_dir: str = "") -> Settings:
    """Load settings: defaults → user settings → project settings (override)."""
    settings = Settings()

    # 1. User-level settings
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, encoding="utf-8") as f:
                user_data = json.load(f)
            settings = _dict_to_settings(user_data)
        except (json.JSONDecodeError, IOError):
            pass

    # 2. Project-level settings (override)
    if project_dir:
        project_settings = os.path.join(project_dir, ".zhangl-agent", "settings.json")
        if os.path.exists(project_settings):
            try:
                with open(project_settings, encoding="utf-8") as f:
                    project_data = json.load(f)
                project_settings_obj = _dict_to_settings(project_data)
                settings = _merge_settings(settings, project_settings_obj)
            except (json.JSONDecodeError, IOError):
                pass

    return settings


def _merge_settings(base: Settings, override: Settings) -> Settings:
    """Override non-default values from override into base."""
    o = override.model
    if o.model_provider != DEFAULT_SETTINGS.model.model_provider:
        base.model.model_provider = o.model_provider
    if o.auth_token != DEFAULT_SETTINGS.model.auth_token:
        base.model.auth_token = o.auth_token
    if o.base_url != DEFAULT_SETTINGS.model.base_url:
        base.model.base_url = o.base_url
    if o.default_model != DEFAULT_SETTINGS.model.default_model:
        base.model.default_model = o.default_model
    if o.default_model_max_tokens != DEFAULT_SETTINGS.model.default_model_max_tokens:
        base.model.default_model_max_tokens = o.default_model_max_tokens
    if o.smart_model != DEFAULT_SETTINGS.model.smart_model:
        base.model.smart_model = o.smart_model
    if o.small_model != DEFAULT_SETTINGS.model.small_model:
        base.model.small_model = o.small_model
    if o.expert_thinking_turns != DEFAULT_SETTINGS.model.expert_thinking_turns:
        base.model.expert_thinking_turns = o.expert_thinking_turns
    if override.permissions.allow:
        base.permissions.allow = override.permissions.allow
    if override.permissions.deny:
        base.permissions.deny = override.permissions.deny
    if override.export.default_format != DEFAULT_SETTINGS.export.default_format:
        base.export.default_format = override.export.default_format
    if override.export.default_dir != DEFAULT_SETTINGS.export.default_dir:
        base.export.default_dir = override.export.default_dir
    if override.memory.enabled != DEFAULT_SETTINGS.memory.enabled:
        base.memory.enabled = override.memory.enabled
    if override.status_line.type != DEFAULT_SETTINGS.status_line.type:
        base.status_line = override.status_line
    if override.ui.dialog_style != DEFAULT_SETTINGS.ui.dialog_style:
        base.ui = override.ui
    return base


def save_settings(settings: Settings):
    """Save settings to user-level settings.json."""
    os.makedirs(SETTINGS_DIR, exist_ok=True)
    mc = settings.model
    data = {
        "model": {
            "MODEL_PROVIDER": mc.model_provider,
            "ZHANGL_BASE_URL": mc.base_url,
            "ZHANGL_AUTH_TOKEN": mc.auth_token,
            "DEFAULT_MODEL": mc.default_model,
            "DEFAULT_MODEL_MAX_TOKENS": mc.default_model_max_tokens,
            "SMART_MODEL": mc.smart_model,
            "SMART_MODEL_MAX_TOKENS": mc.smart_model_max_tokens,
            "SMALL_MODEL": mc.small_model,
            "SMALL_MODEL_MAX_TOKENS": mc.small_model_max_tokens,
            "EXPERT_THINKING_TURNS": mc.expert_thinking_turns,
        },
        "permissions": {
            "allow": settings.permissions.allow,
            "deny": settings.permissions.deny,
            "ask_before": settings.permissions.ask_before,
        },
        "memory": {
            "enabled": settings.memory.enabled,
            "storage_dir": settings.memory.storage_dir,
            "auto_remember": settings.memory.auto_remember,
        },
        "export": {
            "default_format": settings.export.default_format,
            "default_dir": settings.export.default_dir,
            "formats": {
                name: {"enabled": f.enabled, "template": f.template}
                for name, f in settings.export.formats.items()
            },
        },
        "status_line": {
            "type": settings.status_line.type,
            "items": settings.status_line.items,
        },
        "ui": {
            "theme": settings.ui.theme,
            "dialog_style": settings.ui.dialog_style,
        },
    }
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_active_provider(settings: Settings) -> tuple[str, str, str, str, int]:
    """Get (provider_type, api_key, api_base, model, max_tokens).

    Priority: settings.json > env vars (env vars are fallback only).
    """
    mc = settings.model
    # Primary: settings file
    api_key = mc.auth_token
    api_base = mc.base_url

    # Fallback: env vars
    if not api_key:
        api_key = os.environ.get("ANTHROPIC_AUTH_TOKEN", "") or os.environ.get("OPENAI_API_KEY", "")
    if not api_base:
        api_base = os.environ.get("ANTHROPIC_BASE_URL", "") or os.environ.get("OPENAI_API_BASE", "")

    # Determine provider type if not explicitly set
    provider = mc.model_provider
    if not provider and "anthropic" in (api_base or "").lower():
        provider = "anthropic"
    elif not provider:
        provider = "openai"

    model = mc.default_model or "deepseek-v4-flash"
    max_tokens = mc.default_model_max_tokens or 32768

    return provider, api_key, api_base, model, max_tokens


def check_permission(settings: Settings, tool_name: str, tool_args: dict = None) -> tuple[bool, str]:
    """Check if a tool call is allowed. Returns (allowed, reason)."""
    perm = settings.permissions

    if tool_name in perm.deny:
        return False, f"Tool '{tool_name}' is denied in settings"

    if perm.allow and tool_name not in perm.allow:
        return False, f"Tool '{tool_name}' is not in allowlist"

    # Check ask_before for write operations
    if tool_name == "write_file" and perm.ask_before:
        path = (tool_args or {}).get("path", "")
        cwd = os.getcwd()
        if not os.path.abspath(path).startswith(os.path.abspath(cwd)):
            return False, "Writing outside project directory requires confirmation"

    return True, ""
