/**
 * MiMo v2.5 wire format types (OpenAI-compatible).
 *
 * Source: MiMo API documentation at https://www.mimo-v2.com/zh/docs
 * and https://help.aliyun.com/zh/model-studio/mimo
 *
 * @module dsh-llm-mimo/types
 */

/** Request body for `POST {baseURL}/chat/completions`. */
export interface WireRequest {
  model: string
  messages: WireMessage[]
  stream: true
  stream_options: { include_usage: true }
  /** Thinking-mode toggle (MiMo-specific, non-OpenAI standard). */
  enable_thinking?: boolean
  tools?: WireTool[]
  temperature?: number
  max_tokens?: number
  max_completion_tokens?: number
  top_p?: number
  /** Stop sequences:最多 4 个序列. */
  stop?: string[]
  frequency_penalty?: number
  presence_penalty?: number
}

/** System-role message. */
export interface WireSystemMessage {
  role: 'system'
  content: string
}

/** User-role message. */
export interface WireUserMessage {
  role: 'user'
  content: string
}

/** Tool-role message: the result of one tool call. */
export interface WireToolMessage {
  role: 'tool'
  tool_call_id: string
  content: string
}

/** One entry of the request `messages` array, discriminated on `role`. */
export type WireMessage =
  | WireSystemMessage
  | WireUserMessage
  | WireAssistantMessage
  | WireToolMessage

/**
 * Assistant-role history message. The harness replays `content: ""` (never
 * null) on text-less turns — pure tool-call and reasoning-only turns alike —
 * because some gateways reject null-content assistant messages outright, and
 * the message sits durably in the session log.
 */
export interface WireAssistantMessage {
  role: 'assistant'
  content: string
  /**
   * CoT passback. REQUIRED on assistant turns that carried tool calls
   * (thinking mode); ignored on tool-call-free turns (we omit it there to
   * save tokens).
   */
  reasoning_content?: string
  tool_calls?: WireToolCall[]
}

/** A completed tool call replayed on an assistant history message. */
export interface WireToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** One entry of the request `tools` array. */
export interface WireTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** One parsed SSE `data:` payload (a chat.completion.chunk). */
export interface WireChunk {
  choices?: WireChoice[]
  /** Arrives attached to the finish chunk and/or as a trailing usage-only chunk. */
  usage?: WireUsage | null
}

/** One streamed choice. */
export interface WireChoice {
  delta?: WireDelta
  finish_reason?: string | null
}

/** The incremental content of one streamed choice. */
export interface WireDelta {
  role?: string
  /** Visible text. Null/empty on reasoning/tool-call chunks. */
  content?: string | null
  /**
   * Thinking-mode CoT. The FIRST chunk carries an empty string (must not
   * open a reasoning block); absent entirely in non-thinking mode.
   */
  reasoning_content?: string | null
  tool_calls?: WireToolCallDelta[]
}

/** A streamed fragment of one tool call. */
export interface WireToolCallDelta {
  /** Disambiguates parallel tool calls; stable across a call's deltas. */
  index: number
  /** Present on the first delta of each call only. */
  id?: string
  type?: 'function'
  function?: {
    /** Present on the first delta of each call only. */
    name?: string
    /** Argument JSON fragment (concatenate across deltas). */
    arguments?: string
  }
}

/**
 * Wire token accounting.
 * MiMo reports `prompt_tokens_details.cached_tokens` for cache hits.
 */
export interface WireUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
  completion_tokens_details?: { reasoning_tokens?: number }
}

/** Non-2xx error body. */
export interface WireError {
  error?: { message?: string; type?: string; code?: string }
}
