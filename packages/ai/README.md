# @aicontainer/ai

Die LLM-Anbindung: Modelle beschreiben, Anfragen stellen, Antworten streamen.

- Ein Provider, `openrouter`, über Vercel AI SDK Core (`ai`) und `@openrouter/ai-sdk-provider`.
- `providers/openrouter.models.ts` ist der statische Modellkatalog, `api/ai-sdk.ts` übersetzt die SDK-Streams in die Ereignisse der Agentenlaufzeit.
- `api-registry.ts` hält die API-Registrierung und den Faux-Provider, mit dem die Engine-Tests ohne Netz laufen.

Das SDK übernimmt HTTP, Providerformat und Streaming. Nachrichtenkonvertierung, Modellkatalog, Kostenberechnung und der Vertrag zur Agentenlaufzeit bleiben hier. Die Protokollkennung `openai-completions` bleibt für Modelle und gespeicherte Sitzungen erhalten; sie bezeichnet keine eigene Providerimplementierung mehr. Auch Bilderzeugung verwendet AI SDK Core.

Die Session- und Agentenschleife in `@aicontainer/agent` und `@aicontainer/agent-core` bleibt bestehen. Herkunft und eigene Eingriffe stehen in `docs/decisions.md`.
