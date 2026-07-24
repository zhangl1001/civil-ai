#!/usr/bin/env python3
"""
Zhangl Agent - AI-powered agent framework.

Usage:
  zhanglnb                 # Start interactive REPL
  zhanglnb -s "prompt"     # One-shot mode
"""

import asyncio
import os
import sys
import click
from cli.settings import load_settings, get_active_provider
from cli.repl import Repl




@click.command()
@click.option("--api-key", default="", help="Override API key")
@click.option("--api-base", default="", help="Override API base URL")
@click.option("--model", default="", help="Override model")
@click.option("--provider", default="", help="Override provider: anthropic, openai")
@click.option("--one-shot", "-s", default="", help="Single prompt mode")
def main(api_key: str, api_base: str, model: str, provider: str, one_shot: str):
    """Zhangl Agent — AI-powered agent framework."""

    settings = load_settings()

    # CLI args override settings
    provider_type, resolved_key, resolved_base, resolved_model, max_tokens = get_active_provider(settings)
    if api_key:
        resolved_key = api_key
    if api_base:
        resolved_base = api_base
    if model:
        resolved_model = model
    if provider:
        provider_type = provider

    repl = Repl(
        settings=settings,
        api_key=resolved_key,
        api_base=resolved_base,
        model=resolved_model,
        provider=provider_type,
        max_tokens=max_tokens,
    )

    if one_shot:
        asyncio.run(repl.process(one_shot))
    else:
        repl.run()


if __name__ == "__main__":
    main()
