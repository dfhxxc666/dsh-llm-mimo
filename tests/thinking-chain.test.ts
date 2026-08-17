/**
 * Tests for the MiMo adapter's thinking chain translation and wire
 * serialization against the current DeepSeek Harness LLM seam.
 *
 * - `translate`/`mapUsage`/`mapFinishReason`: reasoning_content from MiMo SSE
 *   responses is translated into harness ReasoningBlock format.
 * - `serializeRequest`: messages built with the harness Message helpers
 *   serialize per the adapter contract — tool results expand to role:'tool',
 *   assistant content is never null, reasoning replays only on tool-call
 *   turns, and unsupported image content is rejected.
 */

import { describe, expect, it } from 'vitest'
import {
  CallId,
  createAssistantMessage,
  createMessage,
  createToolResultMessage,
  createUserMessage,
} from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { translate, mapUsage, mapFinishReason } from '../src/translate.ts'
import { serializeRequest } from '../src/serialize.ts'
import type { WireAssistantMessage, WireChunk, WireToolMessage } from '../src/types.ts'

const PROVIDER = 'mimo-official'
const MODEL = 'mimo-v2.5-pro'

/** Build the minimum GenerateOptions for serialization tests. */
function request(messages: Message[]): GenerateOptions {
  return { provider: PROVIDER, model: MODEL, messages }
}

function text(content: string): ContentBlock {
  return { type: 'text', text: content }
}

describe('translate', () => {
  it('should translate reasoning_content to ReasoningBlock', async () => {
    const payloads = createMockPayloads([
      {
        choices: [{ delta: { reasoning_content: 'Let me think about this...' } }],
      },
      {
        choices: [{ delta: { content: 'The answer is 42.' } }],
      },
      {
        choices: [{ finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 0 },
          completion_tokens_details: { reasoning_tokens: 10 },
        },
      },
    ])

    const chunks: any[] = []
    for await (const chunk of translate(payloads)) {
      chunks.push(chunk)
    }

    // Block ends are deferred to the [DONE] sentinel: deltas first, then
    // block-end(reasoning), block-end(text), usage, finish.
    expect(chunks).toHaveLength(8)

    // Reasoning block
    expect(chunks[0]).toEqual({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(chunks[1]).toEqual({ type: 'reasoning-delta', index: 0, text: 'Let me think about this...' })

    // Text block
    expect(chunks[2]).toEqual({ type: 'block-start', index: 1, blockType: 'text' })
    expect(chunks[3]).toEqual({ type: 'text-delta', index: 1, text: 'The answer is 42.' })

    // Flushed block ends
    expect(chunks[4]).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'reasoning', text: 'Let me think about this...' },
    })
    expect(chunks[5]).toEqual({
      type: 'block-end',
      index: 1,
      block: { type: 'text', text: 'The answer is 42.' },
    })

    // Usage (cached_tokens: 0 is a real value, kept on the wire)
    expect(chunks[6]).toEqual({
      type: 'usage',
      usage: {
        inputTokens: 10,
        outputTokens: 20,
        cacheReadTokens: 0,
        reasoningTokens: 10,
      },
    })

    // Finish
    expect(chunks[7]).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('should not open reasoning block for empty first chunk', async () => {
    const payloads = createMockPayloads([
      {
        choices: [{ delta: { reasoning_content: '' } }], // Empty first chunk
      },
      {
        choices: [{ delta: { reasoning_content: 'Real reasoning content.' } }],
      },
      {
        choices: [{ delta: { content: 'Response.' } }],
      },
      {
        choices: [{ finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      },
    ])

    const chunks: any[] = []
    for await (const chunk of translate(payloads)) {
      chunks.push(chunk)
    }

    // Should NOT have a block-start for the empty chunk
    const reasoningStarts = chunks.filter(c => c.type === 'block-start' && c.blockType === 'reasoning')
    expect(reasoningStarts).toHaveLength(1) // Only one block-start for reasoning
  })

  it('should handle tool calls interleaved with reasoning', async () => {
    const payloads = createMockPayloads([
      {
        choices: [{ delta: { reasoning_content: 'I need to call a tool.' } }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              function: { name: 'get_weather', arguments: '{"location":' },
            }],
          },
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '"Beijing"}' },
            }],
          },
        }],
      },
      {
        choices: [{ finish_reason: 'tool_calls' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          completion_tokens_details: { reasoning_tokens: 5 },
        },
      },
    ])

    const chunks: any[] = []
    for await (const chunk of translate(payloads)) {
      chunks.push(chunk)
    }

    // Should have reasoning block followed by tool-call block
    const blockStarts = chunks.filter(c => c.type === 'block-start')
    expect(blockStarts).toHaveLength(2)
    expect(blockStarts[0].blockType).toBe('reasoning')
    expect(blockStarts[1].blockType).toBe('tool-call')

    // Tool call should have correct id and arguments
    const toolCallEnd = chunks.find(c => c.type === 'block-end' && c.block.type === 'tool-call')
    expect(toolCallEnd.block.id).toBe('call_123')
    expect(toolCallEnd.block.name).toBe('get_weather')
    expect(toolCallEnd.block.arguments).toBe('{"location":"Beijing"}')

    // Finish reason should be tool-calls
    const finish = chunks.find(c => c.type === 'finish')
    expect(finish.reason).toEqual({ kind: 'tool-calls' })
  })

  it('should handle reasoning-only response', async () => {
    const payloads = createMockPayloads([
      {
        choices: [{ delta: { reasoning_content: 'Just thinking...' } }],
      },
      {
        choices: [{ finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 10,
          completion_tokens_details: { reasoning_tokens: 10 },
        },
      },
    ])

    const chunks: any[] = []
    for await (const chunk of translate(payloads)) {
      chunks.push(chunk)
    }

    // Should have reasoning block but no text block
    const blockStarts = chunks.filter(c => c.type === 'block-start')
    expect(blockStarts).toHaveLength(1)
    expect(blockStarts[0].blockType).toBe('reasoning')

    // Finish should be stop (not error, since reasoning is content)
    const finish = chunks.find(c => c.type === 'finish')
    expect(finish.reason).toEqual({ kind: 'stop' })
  })
})

describe('mapUsage', () => {
  it('should map usage with reasoning tokens', () => {
    const usage = mapUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 20 },
      completion_tokens_details: { reasoning_tokens: 30 },
    })

    expect(usage).toEqual({
      inputTokens: 80, // 100 - 20 cached
      outputTokens: 50,
      cacheReadTokens: 20,
      reasoningTokens: 30,
    })
  })

  it('should handle missing optional fields', () => {
    const usage = mapUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    })

    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    })
  })
})

describe('mapFinishReason', () => {
  it('should map the OpenAI finish_reason vocabulary', () => {
    expect(mapFinishReason('stop')).toEqual({ kind: 'stop' })
    expect(mapFinishReason('tool_calls')).toEqual({ kind: 'tool-calls' })
    expect(mapFinishReason('length')).toEqual({ kind: 'max-tokens' })
    expect(mapFinishReason('content_filter')).toEqual({
      kind: 'error',
      failure: { message: 'model stopped: content_filter', code: 'CONTENT_FILTER' },
    })
  })
})

describe('serializeRequest', () => {
  it('should replay reasoning_content ONLY on tool-call turns', () => {
    const plain = serializeRequest(request([
      createUserMessage({ content: [text('Hello')], source: { kind: 'user' } }),
      createAssistantMessage({
        source: { provider: PROVIDER, model: MODEL },
        content: [
          { type: 'reasoning', text: 'User says hello.' },
          text('Hi there!'),
        ],
      }),
      createUserMessage({ content: [text('How are you?')], source: { kind: 'user' } }),
    ]), { enableThinking: true })

    const plainAssistant = plain.messages[1] as WireAssistantMessage
    expect(plainAssistant.content).toBe('Hi there!')
    // Reasoning is ignored on tool-call-free turns: omitted to save tokens.
    expect(plainAssistant.reasoning_content).toBeUndefined()

    const toolTurn = serializeRequest(request([
      createUserMessage({ content: [text('What is the weather?')], source: { kind: 'user' } }),
      createAssistantMessage({
        source: { provider: PROVIDER, model: MODEL },
        content: [
          { type: 'reasoning', text: 'I should check the weather.' },
          {
            type: 'tool-call',
            id: CallId('call_1'),
            name: 'get_weather',
            arguments: '{"city":"Beijing"}',
          },
        ],
      }),
      createToolResultMessage({
        callId: CallId('call_1'),
        content: [text('20°C, sunny')],
        isError: false,
      }),
    ]), { enableThinking: true })

    const toolAssistant = toolTurn.messages[1] as WireAssistantMessage
    // Text-less turn: content "" — NEVER null.
    expect(toolAssistant.content).toBe('')
    // Reasoning required on tool-call turns (thinking mode).
    expect(toolAssistant.reasoning_content).toBe('I should check the weather.')
    expect(toolAssistant.tool_calls).toEqual([{
      id: 'call_1',
      type: 'function',
      function: { name: 'get_weather', arguments: '{"city":"Beijing"}' },
    }])
  })

  it('should expand tool results into role:tool wire messages', () => {
    const wire = serializeRequest(request([
      createUserMessage({ content: [text('Please call the tool.')], source: { kind: 'user' } }),
      createToolResultMessage({
        callId: CallId('call_7'),
        content: [text('42')],
        isError: false,
      }),
      createToolResultMessage({
        callId: CallId('call_8'),
        content: [],
        isError: false,
      }),
    ]), { enableThinking: true })

    expect(wire.messages[0]).toEqual({ role: 'user', content: 'Please call the tool.' })
    expect(wire.messages[1]).toEqual({ role: 'tool', tool_call_id: 'call_7', content: '42' })
    // Empty tool output still needs SOME content on the wire.
    const empty = wire.messages[2] as WireToolMessage
    expect(empty).toEqual({ role: 'tool', tool_call_id: 'call_8', content: '(no output)' })
  })

  it('should omit reasoning-only assistant reasoning from the wire when no tool calls', () => {
    const wire = serializeRequest(request([
      createUserMessage({ content: [text('hi')], source: { kind: 'user' } }),
      createAssistantMessage({
        source: { provider: PROVIDER, model: MODEL },
        content: [{ type: 'reasoning', text: 'Pure reasoning answer.' }],
      }),
    ]), { enableThinking: true })

    const assistant = wire.messages[1] as WireAssistantMessage
    expect(assistant.content).toBe('')
    expect(assistant.reasoning_content).toBeUndefined()
  })

  it('should reject image content instead of silently dropping it', () => {
    const withImage = createUserMessage({
      content: [{ type: 'image', attachment: {} } as unknown as ContentBlock],
      source: { kind: 'user' },
    })
    expect(() => serializeRequest(request([withImage]), { enableThinking: true }))
      .toThrowError(/does not support image content/)
  })

  it('should force thinking off for session-title purposes', () => {
    const wire = serializeRequest(
      {
        ...request([createUserMessage({ content: [text('title me')], source: { kind: 'user' } })]),
        purpose: 'session-title',
      },
      { enableThinking: true },
    )
    expect(wire.enable_thinking).toBe(false)
  })

  it('should set enable_thinking from defaults', () => {
    const on = serializeRequest(
      request([createUserMessage({ content: [text('test')], source: { kind: 'user' } })]),
      { enableThinking: true },
    )
    expect(on.enable_thinking).toBe(true)

    const off = serializeRequest(
      request([createUserMessage({ content: [text('test')], source: { kind: 'user' } })]),
      { enableThinking: false },
    )
    expect(off.enable_thinking).toBe(false)
  })

  it('should serialize a system prompt into the system slot', () => {
    const wire = serializeRequest({
      ...request([createUserMessage({ content: [text('hi')], source: { kind: 'user' } })]),
      system: 'You are a helpful assistant.',
    }, { enableThinking: true })
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'You are a helpful assistant.' })
  })

  it('should cap stop sequences at 4', () => {
    const wire = serializeRequest(
      {
        ...request([createUserMessage({ content: [text('hi')], source: { kind: 'user' } })]),
        stop: ['a', 'b', 'c', 'd', 'e'],
      },
      { enableThinking: true },
    )
    expect(wire.stop).toEqual(['a', 'b', 'c', 'd'])
  })

  it('should accept a plugin-sourced system message', () => {
    const wire = serializeRequest(request([
      createMessage({
        role: 'system',
        content: [text('System instructions.')],
        source: { kind: 'plugin', plugin: 'test' },
      }),
      createUserMessage({ content: [text('hi')], source: { kind: 'user' } }),
    ]), { enableThinking: true })
    expect(wire.messages[0]).toEqual({ role: 'system', content: 'System instructions.' })
  })
})

// Helper to create mock SSE payloads
async function* createMockPayloads(chunks: WireChunk[]): AsyncGenerator<string> {
  for (const chunk of chunks) {
    yield JSON.stringify(chunk)
  }
  yield '[DONE]'
}
