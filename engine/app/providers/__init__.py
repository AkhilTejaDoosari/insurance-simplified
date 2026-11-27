"""Model provider clients: one module per provider (AGENTS.md), nothing else calls a model.

``nvidia`` speaks the OpenAI-compatible chat-completions shape that the web app's
``web/app/lib/llm/client.ts`` already uses for Nemotron, configured by the same
variables (LLM_BASE_URL, LLM_API_KEY, LLM_MODEL). ``anthropic`` is the Messages API for
visual page analysis. Both return parsed JSON that already matched the caller's schema,
plus token usage for the cost ledger.
"""
