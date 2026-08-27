# Changelog

## v0.1.0 (2026-08-27)

Initial release — fork of [GuanxuJi/dsh-llm-mimo](https://github.com/GuanxuJi/dsh-llm-mimo).

### Added / Fixed (10 changes vs upstream)

1. **`sanitizeArguments` — tool args defense** (`src/serialize.ts`): MiMo strictly requires valid JSON in `tool_calls[].function.arguments` on replayed history. Interrupted tool calls leave truncated/invalid argument strings in session log; replaying them triggers `400 INVALID_REQUEST`. Now degrades invalid JSON to `{}`.
2. **`DEFAULT_MAX_TOKENS` → 131072** (`src/adapter.ts`): MiMo API hard limit is 131072; upstream default 256000 caused 400.
3. **`prepareCall` hook** (`src/adapter.ts`): Adapts dsh-llm ≥0.1.1-rc.2 LlmRuntime API (otherwise `registration.adapter.prepareCall is not a function`).
4. **API Key 60s cache** (`src/adapter.ts`): Avoids repeated credential lookups per request.
5. **fetch `keepalive`** (`src/adapter.ts`): Reuse TCP/TLS connections for reduced handshake overhead.
6. **Dynamic thinking timeout** (`src/adapter.ts`): 1.5× idle timeout (cap 450s) when thinking mode is on.
7. **Robust error parsing** (`src/adapter.ts`): `response.text()` + `JSON.parse` instead of `response.json()` (empty body no longer throws).
8. **Dependency upgrade** (`package.json`): peer/dev `@deepseek-ai/dsh-llm` → `^0.1.1-rc.2`; added `dsh-brand` / `dsh-attachment` / `dsh-invariants` exact `0.1.1-rc.2`.
9. **Sampling param passthrough** (`src/serialize.ts`): `top_p` / `frequency_penalty` / `presence_penalty` sent to MiMo API.
10. **tool-call null override fix** (`src/translate.ts`): Streaming tool-call subsequent chunks with `id`/`name` = `null` no longer overwrite the first chunk's real values.

### Installation

```bash
dsh plugin --profile web add github:dfhxxc666/dsh-llm-mimo --config.minimum-release-age=0
```

See [README](https://github.com/dfhxxc666/dsh-llm-mimo#installation) for details.
