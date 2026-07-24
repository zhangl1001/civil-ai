"""
LLM Client abstraction - supports both Anthropic and OpenAI-compatible APIs.

Provider detection:
- If api_key starts with 'sk-ant' → Anthropic provider
- Otherwise → OpenAI-compatible provider (works with DeepSeek, OpenAI, etc.)
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional
from enum import Enum


class ProviderType(str, Enum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    OLLAMA = "ollama"


@dataclass
class ToolSchema:
    """Unified tool schema, converted to provider-specific format on send."""
    name: str
    description: str
    parameters: dict  # JSON Schema for the parameters


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ResponseChunk:
    text: Optional[str] = None
    thinking: Optional[str] = None  # Model's internal reasoning
    thinking_signature: Optional[str] = None  # Required by Anthropic to pass thinking back
    tool_call: Optional[ToolCall] = None
    is_done: bool = False
    usage: Optional[dict] = None


class LLMProvider(ABC):
    """Abstract LLM provider. Implementations handle API-specific formats."""

    @abstractmethod
    async def chat(
        self,
        messages: list[dict],
        tools: list[ToolSchema],
        stream: bool = True,
    ) -> AsyncIterator[ResponseChunk]:
        ...

    @abstractmethod
    def estimate_tokens(self, messages: list[dict]) -> int:
        ...


def detect_provider(
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    forced: Optional[str] = None,
) -> ProviderType:
    """Detect provider protocol.

    - Ollama: URL contains 'localhost:11434' or 'ollama'
    - Anthropic: sk-ant keys, or URL contains 'anthropic'
    - OpenAI protocol: everything else
    """
    if api_base and ("11434" in api_base or "ollama" in api_base.lower()):
        return ProviderType.OLLAMA
    if api_key and api_key.startswith("sk-ant"):
        return ProviderType.ANTHROPIC
    if api_base and "anthropic" in api_base.lower():
        return ProviderType.ANTHROPIC
    if forced and forced.lower() in ("anthropic", "claude"):
        return ProviderType.ANTHROPIC
    if forced and forced.lower() in ("ollama",):
        return ProviderType.OLLAMA
    return ProviderType.OPENAI


def create_provider(
    provider_type: ProviderType,
    api_key: str,
    api_base: Optional[str] = None,
    model: str = "deepseek-chat",
    max_tokens: int = 32768,
    thinking_mode: str = "disabled",
) -> LLMProvider:
    if provider_type == ProviderType.ANTHROPIC:
        from agent.providers.anthropic_provider import AnthropicProvider
        return AnthropicProvider(api_key=api_key, api_base=api_base, model=model, max_tokens=max_tokens, thinking_mode=thinking_mode)
    elif provider_type == ProviderType.OLLAMA:
        from agent.providers.ollama_provider import OllamaProvider
        return OllamaProvider(api_key=api_key, api_base=api_base, model=model, max_tokens=max_tokens, thinking_mode=thinking_mode)
    else:
        from agent.providers.openai_provider import OpenAIProvider
        return OpenAIProvider(api_key=api_key, api_base=api_base, model=model, max_tokens=max_tokens, thinking_mode=thinking_mode)
