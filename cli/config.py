"""
Config manager - reads/writes platform config directory (Windows: %APPDATA%/zhangl-agent/).
"""

import json
import os
import sys
from dataclasses import dataclass, field
from typing import Optional

from cli.settings import SETTINGS_DIR

CONFIG_DIR = SETTINGS_DIR
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")


@dataclass
class ProviderConfig:
    api_key: str = ""
    api_base: str = ""
    model: str = "deepseek-chat"


@dataclass
class AppConfig:
    default_provider: str = "openai"  # "anthropic" or "openai"
    providers: dict[str, ProviderConfig] = field(default_factory=dict)


def load_config() -> AppConfig:
    if not os.path.exists(CONFIG_FILE):
        return AppConfig()
    try:
        with open(CONFIG_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return AppConfig()

    config = AppConfig(
        default_provider=data.get("default_provider", "openai"),
    )
    for name, pdata in data.get("providers", {}).items():
        config.providers[name] = ProviderConfig(
            api_key=pdata.get("api_key", ""),
            api_base=pdata.get("api_base", ""),
            model=pdata.get("model", "deepseek-chat"),
        )
    return config


def save_config(config: AppConfig):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    data = {
        "default_provider": config.default_provider,
        "providers": {
            name: {
                "api_key": pc.api_key,
                "api_base": pc.api_base,
                "model": pc.model,
            }
            for name, pc in config.providers.items()
        }
    }
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
