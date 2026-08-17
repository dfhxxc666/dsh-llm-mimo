/**
 * Example: Using the MiMo adapter with DeepSeek Harness
 *
 * This example shows how to use the llm-mimo plugin to interact with
 * MiMo v2.5 models and correctly process thinking chains.
 *
 * Prerequisites:
 *   export MIMO_API_KEY="your-api-key-here"
 */

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { ReasoningEffortId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import * as llmMimo from '../src/index.ts'

async function main() {
  const ctx = new Context()

  // The LLM seam provides ctx.llm; llm-mimo injects it.
  ctx.plugin(LlmRuntime)

  // Register the MiMo adapter
  ctx.plugin(llmMimo, {
    enableThinking: true,
  })

  // Get the LLM service
  const llm = ctx.get('llm')
  if (!llm) {
    console.error('LLM service not available')
    process.exit(1)
  }

  // List available providers
  const providers = llm.listProviders()
  console.log('Available providers:', providers.map(p => p.id))

  // List models for the MiMo provider
  const models = await llm.listModels('mimo-official')
  console.log('Available models:', models.map(m => m.id))

  // Generate a response with thinking chain
  console.log('\n--- Generating response with thinking chain ---\n')

  const stream = llm.stream({
    provider: 'mimo-official',
    model: 'mimo-v2.5-pro',
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: '请解释什么是快速排序算法，并给出时间复杂度分析。' }],
        source: { kind: 'user' },
      }),
    ],
    reasoningEffort: ReasoningEffortId('on'), // Enable thinking
  })

  let reasoningContent = ''
  let textContent = ''

  for await (const chunk of stream) {
    handleChunk(chunk)
  }

  function handleChunk(chunk: StreamChunk) {
    switch (chunk.type) {
      case 'block-start':
        if (chunk.blockType === 'reasoning') {
          console.log('\n=== 思考过程 ===\n')
        } else if (chunk.blockType === 'text') {
          console.log('\n=== 回复内容 ===\n')
        }
        break

      case 'reasoning-delta':
        process.stdout.write(chunk.text)
        reasoningContent += chunk.text
        break

      case 'text-delta':
        process.stdout.write(chunk.text)
        textContent += chunk.text
        break

      case 'block-end':
        if (chunk.block.type === 'reasoning') {
          console.log('\n\n(思考过程结束)')
        } else if (chunk.block.type === 'text') {
          console.log('\n\n(回复结束)')
        }
        break

      case 'usage':
        console.log('\n--- Token 使用情况 ---')
        console.log(`  输入 tokens: ${chunk.usage.inputTokens}`)
        console.log(`  输出 tokens: ${chunk.usage.outputTokens}`)
        if (chunk.usage.reasoningTokens) {
          console.log(`  思考 tokens: ${chunk.usage.reasoningTokens}`)
        }
        if (chunk.usage.cacheReadTokens) {
          console.log(`  缓存读取 tokens: ${chunk.usage.cacheReadTokens}`)
        }
        break

      case 'finish':
        console.log('\n--- 完成原因 ---')
        console.log(`  ${chunk.reason.kind}`)
        if (chunk.reason.kind === 'error') {
          console.log(`  错误: ${chunk.reason.failure.message}`)
        }
        break
    }
  }

  console.log('\n--- 汇总 ---')
  console.log(`思考内容长度: ${reasoningContent.length} 字符`)
  console.log(`回复内容长度: ${textContent.length} 字符`)

  // In a real host, the composition lifecycle (profile boot / HMR) owns
  // teardown; a bare script simply returns and the process exits.
}

main().catch(console.error)
