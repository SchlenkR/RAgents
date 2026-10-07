# @ragents/ai

The LLM connection: describe models, send requests, stream responses.

- The built-in provider `openrouter` through Vercel AI SDK Core (`ai`) and `@openrouter/ai-sdk-provider`.
- Providers of a profile name an AI SDK package with `sdk`: `mistral` (`@ai-sdk/mistral`) or `openai-compatible` (`@ai-sdk/openai-compatible`), registered in `api/ai-sdk-transport.ts`; a model without `sdk` goes through the OpenRouter provider.
- `providers/openrouter.models.ts` is the static model catalog, `api/ai-sdk.ts` translates the SDK streams into the events of the agent runtime.
- `api-registry.ts` holds the API registry and the faux provider that lets the engine tests run without a network.

The SDK handles HTTP, provider format and streaming. Message conversion, model catalog, cost calculation and the contract with the agent runtime stay here. The protocol id `openai-completions` is kept for models and stored sessions; it no longer denotes a separate provider implementation.

Access comes only as an API key: from the registration of a provider or from `OPENROUTER_API_KEY`. Loop and compaction live in `@ragents/agent`. Origin and our own changes are in `docs/decisions.md`.
