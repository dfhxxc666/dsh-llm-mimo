# dsh-llm-mimo

Xiaomi MiMo v2.5 adapter for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) LLM seam.

> **Fork 说明**：本仓库 fork 自 [GuanxuJi/dsh-llm-mimo](https://github.com/GuanxuJi/dsh-llm-mimo)，
> 在原作者基础上修复了若干会导致 `MiMo API error (HTTP 400) INVALID_REQUEST` 的缺陷，并适配了
> DeepSeek Harness 新版 LLM seam（dsh-llm 0.1.1-rc.2）。修改清单见下文 [Changes from upstream](#changes-from-upstream)。
>
> 本插件由 **AI 辅助适配与维护**（AI-assisted fork）：问题定位、代码修复、测试验证均经 AI 会话完成。

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

## Changes from upstream

本 fork 相对原仓库 `GuanxuJi/dsh-llm-mimo` 的修改（全部已提交并验证）：

| # | 修改 | 文件 | 说明 |
|---|------|------|------|
| 1 | **`sanitizeArguments` — 工具参数防御性校验** | `src/serialize.ts` | **核心修复**：MiMo 严格校验历史 assistant 消息 `tool_calls[].function.arguments` 必须是合法 JSON。工具调用被中断时，会话历史会固化截断/无效的 arguments（如 `{"profileName": "Default", "tabId": ` 只有 36 字符），任何后续请求回放这段历史都会触发 `400 INVALID_REQUEST`。现在非法 JSON 自动降级为 `{}`，会话可正常继续。 |
| 2 | **`DEFAULT_MAX_TOKENS` 修正为 131072** | `src/adapter.ts` | MiMo API 硬上限为 131072，原值 256000 会导致 400。 |
| 3 | **`prepareCall` 实现** | `src/adapter.ts` | 适配 dsh-llm 0.1.1-rc.2 的 LlmRuntime hook（否则报 `registration.adapter.prepareCall is not a function`）。 |
| 4 | **API Key 60s 缓存** | `src/adapter.ts` | 避免每次请求都走凭据解析，降低延迟。 |
| 5 | **fetch `keepalive`** | `src/adapter.ts` | 复用 TCP/TLS 连接，减少握手开销。 |
| 6 | **思考模式动态超时** | `src/adapter.ts` | thinking on 时流空闲超时放宽到 1.5×（上限 450s）。 |
| 7 | **错误响应体健壮解析** | `src/adapter.ts` | `response.text()` + `JSON.parse`，空响应体不再抛异常。 |
| 8 | **依赖升级** | `package.json` | peer/dev `@deepseek-ai/dsh-llm` → `^0.1.1-rc.2`；新增 `dsh-brand` / `dsh-attachment` / `dsh-invariants` 精确版本 `0.1.1-rc.2`（无范围匹配，必须精确）。 |
| 9 | **采样参数透传** | `src/serialize.ts` | `top_p` / `frequency_penalty` / `presence_penalty` 传给 MiMo API。 |
| 10 | **tool-call null 覆盖 bug 修复** | `src/translate.ts` | 流式 tool-call 后续 chunk 将 `id`/`name` 置 null 时不再覆盖首个 chunk 的真实值。 |

## Installation

### 1. Clone + build（推荐，保证本地修复不被覆盖）

```bash
git clone https://github.com/dfhxxc666/dsh-llm-mimo.git ~/.dsh/dsh-llm-mimo
cd ~/.dsh/dsh-llm-mimo
pnpm install --config.minimum-release-age=0
pnpm build          # tsc 产出 lib/
```

> 源码目录内必须 `pnpm install`（link 依赖不会自动补装传递依赖）并 `pnpm build`
> （`lib/` 被 .gitignore 排除，clone 后需自行构建）。

### 2. 在 DSH profile 中激活（link 源，防重装覆盖）

编辑 profile 的 `package.json`（如 `~/.dsh/profiles/web/package.json`），把依赖指向本地源码目录：

```json
"dependencies": {
  "dsh-llm-mimo": "link:C:/Users/<YOU>/.dsh/dsh-llm-mimo"
}
```

然后在 profile 目录执行（更新 lockfile / 建立符号链接）：

```bash
cd ~/.dsh/profiles/web
pnpm install --config.minimum-release-age=0
```

### 3. 配置 `cordis.patch.yml` 激活块

> dsh-llm-mimo 是**非 bundle 型插件**（package.json 无 `dsh.bundle`），不能加进
> `dsh.profile.bundles`（会报 `declares no dsh.bundle`），只能通过 profile 的
> `cordis.patch.yml` 的 `insert` 块注册进 LLM seam。

在 profile 的 `cordis.patch.yml` 追加：

```yaml
- insert:
    - id: llm-mimo
      name: 'dsh-llm-mimo'
      config:
        apiKeyEnv: MIMO_API_KEY
        baseURL: https://api.xiaomimimo.com/v1
        enableThinking: true
        maxTokens: 131072
        defaultContextWindow: 1000000
        models:
          - id: mimo-v2.5-pro
            name: MiMo-V2.5-Pro
            contextWindow: 1000000
          - id: mimo-v2.5
            name: MiMo-V2.5
            contextWindow: 1000000
        streamIdleTimeoutMs: 300000
```

### 4. 配置 API Key（密钥，绝不提交到仓库）

MiMo API Key 通过**环境变量名引用**（`apiKeyEnv: MIMO_API_KEY`），插件在请求时从
DSH 的凭据服务解析，**不会硬编码、不会写入仓库**。

**方式 A：环境变量**（命令行启动 dsh 时）

```bash
# Windows PowerShell
$env:MIMO_API_KEY = "sk-你的密钥"
dsh web
```

**方式 B：DSH credentials 文件**（推荐，持久化）

在 `~/.dsh/.credentials.yaml` 中添加：

```yaml
MIMO_API_KEY: sk-你的密钥
```

**方式 C：`.env` 文件**（项目内）

```
MIMO_API_KEY=sk-你的密钥
```

> ⚠️ **安全提醒**：`sk-...` 密钥属于敏感信息，**永远不要**提交进 git / 写入
> README / 粘贴到 Issue。`lib/`、`node_modules/`、`.env`、凭据文件均已被
> `.gitignore` 排除。

获取 API Key：[MiMo Platform](https://platform.xiaomimimo.com)

### 5. 重启生效

```bash
# 重启 dsh web（用户手动执行）
restart-dsh.ps1        # 或 dsh web
```

重启后在 GUI 模型选择器中选择 **Xiaomi MiMo → MiMo-V2.5-Pro**（或 MiMo-V2.5）即可。

## 通过 DSH AI 会话安装（推荐给本机重装 / 换机）

dsh-llm-mimo 是**非 bundle 型插件**，不能 `dsh plugin add` 一步装好，且有多处易踩的坑
（link 源、源码目录自装依赖、cordis.patch.yml insert 激活、密钥入库、agent 不得代跑重启）。
**最省事的做法是把下面整段指令粘贴给 DSH 的 AI 会话（agent），让它自动执行安装**：

````text
请安装 dsh-llm-mimo（来源：github:dfhxxc666/dsh-llm-mimo），严格按本机环境笔记
DSH-ENV-NOTES.md 的 P16/P17/P19/P20/P21/P28/P29/P30 执行，步骤：

1. clone 到源码目录：git clone https://github.com/dfhxxc666/dsh-llm-mimo.git ~/.dsh/dsh-llm-mimo
2. 在源码目录内（必须）：pnpm install --config.minimum-release-age=0 && pnpm build
   —— 产出 lib/（lib/ 被 .gitignore 排除，clone 后必须 build，P16/P19）
3. profile（~/.dsh/profiles/web）的 package.json dependencies 改为：
   "dsh-llm-mimo": "link:C:/Users/<YOU>/.dsh/dsh-llm-mimo"
   —— 用 link 源防重装覆盖修复（P17/P28），勿用 github: 源
4. profile 的 cordis.patch.yml 追加 llm-mimo insert 块：
   - insert:
       - id: llm-mimo
         name: 'dsh-llm-mimo'
         config:
           apiKeyEnv: MIMO_API_KEY
           baseURL: https://api.xiaomimimo.com/v1
           enableThinking: true
           maxTokens: 131072
           defaultContextWindow: 1000000
           models:
             - id: mimo-v2.5-pro
               name: MiMo-V2.5-Pro
               contextWindow: 1000000
             - id: mimo-v2.5
               name: MiMo-V2.5
               contextWindow: 1000000
           streamIdleTimeoutMs: 300000
   —— 非 bundle 型插件只能靠 insert 块激活（P20/P28），勿加 dsh.profile.bundles
5. 在 profile 目录执行：pnpm install --config.minimum-release-age=0（重链 node_modules 为 SymbolicLink）
6. API Key：把 MIMO_API_KEY 写入 ~/.dsh/.credentials.yaml（sk-... 密钥绝不进 git/README）
7. 验证：
   - dsh --profile web --dump-config | grep -A 3 llm-mimo（配置树含 llm-mimo）
   - grep -c sanitizeArguments ~/.dsh/dsh-llm-mimo/lib/serialize.js（>=1，P29 核心修复在）
8. 重启 dsh web —— 由用户手动执行（agent 不得代跑，红线 P8/P14/P23），
   提供命令：powershell -ExecutionPolicy Bypass -File D:\DeepSeek\restart-dsh.ps1 -Force
9. 重启后 GUI 新建会话选 Xiaomi MiMo → MiMo-V2.5-Pro 发消息验证。
10. 同步检测：git -C ~/.dsh/dsh-llm-mimo fetch origin && git -C ~/.dsh/dsh-llm-mimo fetch dfhxxc666
    && git rev-list --count main..origin/main（>0 说明上游 GuanxuJi 有更新，按 P30 判断是否同步，
    同步后必须重跑 pnpm build 且确认 sanitizeArguments 仍在，勿丢本地修复）
````

> 说明：以上指令把"哪些是坑、为什么这么做"都写进去了，agent 执行时不需要额外猜。
> 环境笔记（DSH-ENV-NOTES.md P30）已收录本流程的完整版，含上游更新检测与冲突判断策略。

## Verification

```bash
# 1. 配置树包含 llm-mimo
dsh --profile web --dump-config | grep -A 3 llm-mimo

# 2. lib 产物含核心修复
grep -c sanitizeArguments lib/serialize.js    # 期望 >= 1

# 3. GUI 测试：新建会话选 MiMo 模型发消息，应正常回复
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKeyEnv` | `string` | `MIMO_API_KEY` | Credential reference (environment-variable name) for the API key |
| `baseURL` | `string` | `https://api.xiaomimimo.com/v1` | API endpoint base URL |
| `enableThinking` | `boolean` | `true` | Whether thinking mode is enabled by default |
| `maxTokens` | `number` | `131072` | Default per-request output token cap (MiMo hard limit) |
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

### Multi-turn conversations

MiMo requires `reasoning_content` to be preserved in assistant messages when
the assistant turn carried tool calls and thinking mode is enabled. On
tool-call-free turns the field is ignored by the provider, so this adapter
omits it there to save tokens.

### Known 400 causes (fixed in this fork)

- **Invalid `tool_calls.arguments` JSON**（interrupted tool call 遗留的截断参数）→ 已由
  `sanitizeArguments` 防御性降级为 `{}`
- **`maxTokens` 超过 131072** → 默认值已修正
- **`prepareCall` 缺失**（dsh-llm 版本不匹配）→ 已实现

## Error Handling

The adapter maps MiMo HTTP error codes to harness error codes:

| HTTP Status | Harness Code | Description |
|-------------|-------------|-------------|
| 401, 403 | `AUTH` | Authentication failure |
| 400 | `INVALID_REQUEST` | Bad request (e.g. invalid tool args JSON, missing `reasoning_content`) |
| 429 | `RATE_LIMIT` | Rate limit exceeded |
| 500+ | `SERVER` | Server error |

## License

MIT — 保留原仓库 [GuanxuJi/dsh-llm-mimo](https://github.com/GuanxuJi/dsh-llm-mimo) 的许可。
