/**
 * Serialize harness GenerateOptions into MiMo wire request bodies.
 *
 * MiMo uses an OpenAI-compatible format with MiMo-specific extensions:
 * - `enable_thinking` to control thinking mode
 * - `reasoning_content` passback in assistant messages, REQUIRED only on
 *   tool-call turns (thinking mode) — see the MiMo API docs.
 *
 * The serialization mirrors the reference DeepSeek adapter: user text is
 * joined, assistant text becomes `content`, tool calls become `tool_calls`,
 * and tool results become separate `{role: 'tool'}` wire messages. Assistant
 * reasoning is replayed as `reasoning_content` only on tool-call turns, and
 * core image blocks are rejected explicitly because this wire route is
 * text-only; unknown declaration-merged block types retain the adapter's
 * documented extension fallback.
 *
 * @module dsh-llm-mimo/serialize
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import type {
  WireAssistantMessage,
  WireMessage,
  WireRequest,
  WireTool,
} from './types.ts'

/** Request defaults resolved from plugin configuration. */
export interface RequestDefaults {
  /** Whether thinking mode is enabled (adapter default; session titles force it off). */
  enableThinking?: boolean
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Reject core image content before any text-flattening path can silently
 * erase it. This wire route is text-only; dropping image blocks would corrupt
 * the conversation the model sees.
 */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The MiMo chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Convert harness ToolSchema to MiMo wire format. */
function toWireTool(tool: ToolSchema): WireTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

/**
 * MiMo strictly requires `tool_calls[].function.arguments` to be valid JSON on
 * replayed history (thinking mode multi-turn). Interrupted tool calls can leave
 * truncated/invalid argument strings in the durable session log; replaying them
 * as-is makes every later turn 400 (see MiMo error docs: "Invalid Format" /
 * reasoning_content passback rules). Defensively downgrade to a valid empty
 * object so the turn can proceed.
 */
function sanitizeArguments(args: string | undefined | null): string {
  if (typeof args !== 'string' || args.length === 0) return '{}'
  try {
    JSON.parse(args)
    return args
  } catch {
    return '{}'
  }
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireAssistantMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: sanitizeArguments(block.arguments) },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns replay
    // content verbatim (""); some gateways reject null outright. Reasoning-
    // only turns (the model can answer entirely in the reasoning channel)
    // likewise: null-content/no-tool_calls assistant messages can 400 and,
    // since the message sits durably in the session log, brick every later
    // turn of that session.
    content: text,
    // MiMo passback rule: reasoning_content must return on tool-call turns
    // (thinking mode); it is ignored on plain turns, so we drop it there to
    // save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
function serializeMessages(messages: readonly Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but the OpenAI-compatible wire wants them as role:'tool'.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Serialize harness GenerateOptions into a MiMo wire request body.
 *
 * @param options - harness generation options.
 * @param defaults - plugin-level request defaults.
 * @returns the wire request body.
 */
export function serializeRequest(options: GenerateOptions, defaults: RequestDefaults = {}): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))

  const tools: WireTool[] | undefined = options.tools?.map(toWireTool)

  // A short title budget must produce visible text, so session-title calls
  // never enable thinking; conversation and compaction calls inherit the
  // adapter's thinking default.
  const enableThinking = options.purpose === 'session-title'
    ? false
    : defaults.enableThinking

  // Structural extension for sampling params not yet declared on GenerateOptions.
  const sampling = options as GenerateOptions & {
    topP?: number
    frequencyPenalty?: number
    presencePenalty?: number
  }

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...enableThinking !== undefined ? { enable_thinking: enableThinking } : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    // Temperature (MiMo range: [0, 1.5], default 1.0)
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    // Max tokens (MiMo uses max_completion_tokens, not max_tokens)
    ...options.maxTokens !== undefined ? { max_completion_tokens: options.maxTokens } : {},
    // Stop sequences (MiMo caps at 4)
    ...options.stop !== undefined && options.stop.length > 0 ? { stop: options.stop.slice(0, 4) } : {},
    // Sampling params supported by MiMo API. Harness GenerateOptions does not
    // declare these fields yet, so read them through a structural extension.
    ...sampling.topP !== undefined ? { top_p: sampling.topP } : {},
    ...sampling.frequencyPenalty !== undefined ? { frequency_penalty: sampling.frequencyPenalty } : {},
    ...sampling.presencePenalty !== undefined ? { presence_penalty: sampling.presencePenalty } : {},
  }
}
