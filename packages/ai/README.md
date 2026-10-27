# @ragents/ai

The LLM connection: describe models, send requests, stream responses.

- The OpenRouter adapter uses Vercel AI SDK Core (`ai`) and `@openrouter/ai-sdk-provider`.
- Providers of a profile name an AI SDK package with `sdk`: `mistral` (`@ai-sdk/mistral`) or `openai-compatible` (`@ai-sdk/openai-compatible`), registered in `api/ai-sdk-transport.ts`; a model without `sdk` uses the OpenRouter request shape.
- Profiles declare every provider and model in `MODEL_PROVIDERS`, including capabilities, limits, and prices. There is no built-in model catalog or metadata fetching.
- `api/ai-sdk.ts` translates SDK streams into agent runtime events; `api-registry.ts` holds the API registry and the faux provider for tests without a network.

The SDK handles HTTP, provider format, and streaming. Message conversion, reasoning formats, routing, usage, and cost calculation stay here. The protocol id `openai-completions` is kept for models and stored sessions.

Access comes from each configured provider's registered API key, resolved from its `apiKey: env("NAME")` reference. Loop and compaction live in `@ragents/agent`. Origin and our own changes are in `docs/decisions.md`.
