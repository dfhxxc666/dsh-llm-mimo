# dsh-llm-mimo

Xiaomi MiMo v2.5 adapter for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) LLM seam.

## Features

- **Thinking chain support**: Correctly recognizes MiMo's `reasoning_content` field and translates it into harness `ReasoningBlock` format
- **Multi-turn conversations**: Preserves `reasoning_content` in assistant messages on tool-call turns, as MiMo requires
- **Tool calling**: Tool results are serialized to OpenAI-compatible `role: 'tool'` messages; text-less assistant turns send `""` (never `null`)
- **OpenAI-compatible API**: Uses MiMo's OpenAI-compatible chat completions endpoint
- **Streaming**: Full SSE streaming support with proper block assembly

## Supported Models

| Model | Description |
|-------|-------------|
| `mimo-v2.5-pro` | MiMo-V2.5-Pro — flagship model for complex reasoning tasks |
| `mimo-v2.5` | MiMo-V2.5 — general-purpose model |

## Installation

### Build

The package follows the harness package layout: `pnpm build` emits `lib/` (JS)
plus `lib/types/` (declarations), which `main`/`exports`/`files` reference.

```bash
pnpm install
pnpm build
pnpm test        # vitest
pnpm typecheck
```

### As a plugin in a DeepSeek Harness profile

A running `dsh` is composed from ordered layers (the profile's
`dsh.profile.bundles`, then the profile's `cordis.patch.yml`, then the
home-level patch, then any `--patch` overlay) — a plugin package's own
`cordis.yml` is NOT auto-discovered. To use this adapter:

```bash
# From the profile directory (e.g. ~/.dsh/profiles/web), install the package:
pnpm add dsh-llm-mimo
```

Then append this block to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: llm-mimo
      name: 'dsh-llm-mimo'
      config:
        apiKeyEnv: MIMO_API_KEY
        baseURL: https://api.xiaomimimo.com/v1
        enableThinking: true
```

In the monorepo workspace, the package sits under `packages/llm/llm-mimo` and
is referenced by name the same way; the repo's tsconfig base replaces the
standalone `tsconfig.json` shipped here.

### Configuration

Set your MiMo API key:

```bash
export MIMO_API_KEY="your-api-key-here"
```

Or in `.env` file:

```
MIMO_API_KEY=your-api-key-here
```

Get your API key from [MiMo Platform](https://platform.xiaomimimo.com).

## Usage

### With DeepSeek Harness Web UI

```bash
# From DeepSeek Harness checkout
pnpm dsh web
```

Then select `mimo-official` as the provider and choose a model.

### Programmatic usage

```typescript
import { Context } from '@deepseek-ai/cordis'
import llmMimo from 'dsh-llm-mimo'

const ctx = new Context()
ctx.plugin(llmMimo, {
  apiKeyEnv: 'MIMO_API_KEY',
  baseURL: 'https://api.xiaomimimo.com/v1',
  enableThinking: true,
})
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKeyEnv` | `string` | `MIMO_API_KEY` | Credential reference (environment-variable name) for the API key |
| `baseURL` | `string` | `https://api.xiaomimimo.com/v1` | API endpoint base URL |
| `enableThinking` | `boolean` | `true` | Whether thinking mode is enabled by default |
| `maxTokens` | `number` | `256000` | Default per-request output token cap |
| `defaultContextWindow` | `number` | `1000000` | Default context window size |
| `models` | `MiMoCatalogModel[]` | V2.5, V2.5-Pro | Advisory model catalog |
| `streamIdleTimeoutMs` | `number` | `300000` | Stream idle timeout (ms) |
| `retryPolicy` | `RetryPolicyConfig` | — | Custom retry policy |

## How Thinking Chain Works

MiMo v2.5 uses the `reasoning_content` field in SSE responses to stream thinking chain content. This is the same format used by DeepSeek's thinking mode.

### Wire format

```json
{
  "choices": [{
    "delta": {
      "reasoning_content": "Let me think about this...",
      "content": null
    }
  }]
}
```

### Harness translation

The adapter translates this into harness `StreamChunk` protocol:

```typescript
// 1. Block start
{ type: 'block-start', index: 0, blockType: 'reasoning' }

// 2. Reasoning deltas
{ type: 'reasoning-delta', index: 0, text: 'Let me think about this...' }

// 3. Block end
{ type: 'block-end', index: 0, block: { type: 'reasoning', text: '...' } }

// 4. Text content (if any)
{ type: 'block-start', index: 1, blockType: 'text' }
{ type: 'text-delta', index: 1, text: 'The answer is...' }
{ type: 'block-end', index: 1, block: { type: 'text', text: '...' } }
```

### Multi-turn conversations

MiMo requires `reasoning_content` to be preserved in assistant messages when
the assistant turn carried tool calls and thinking mode is enabled. On
tool-call-free turns the field is ignored by the provider, so this adapter
omits it there to save tokens.

## API Compatibility

### MiMo-specific parameters

- `enable_thinking` (boolean): Controls thinking mode (non-OpenAI standard, passed via `extra_body` in Python SDK)
- `max_completion_tokens`: Used instead of `max_tokens` for output token limit

### Differences from DeepSeek API

| Feature | DeepSeek | MiMo |
|---------|----------|------|
| Thinking toggle | `thinking.type: 'enabled'` | `enable_thinking: true` |
| Reasoning effort | `reasoning_effort: 'low'` | Not supported |
| Stop sequences | No limit | Max 4 |
| Temperature range | [0, 2) | [0, 1.5] |
| Top-p range | (0, 1] | [0.01, 1] |

## Error Handling

The adapter maps MiMo HTTP error codes to harness error codes:

| HTTP Status | Harness Code | Description |
|-------------|-------------|-------------|
| 401, 403 | `AUTH` | Authentication failure |
| 400 | `INVALID_REQUEST` | Bad request (including missing `reasoning_content`) |
| 429 | `RATE_LIMIT` | Rate limit exceeded |
| 500+ | `SERVER` | Server error |

## License

MIT
