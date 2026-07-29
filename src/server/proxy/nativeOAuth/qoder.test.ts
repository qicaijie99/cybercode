import { afterEach, describe, expect, test } from 'bun:test'
import { qoderRuntimeService } from '../../services/qoderRuntimeService.js'
import {
  executeQoder,
  qoderAdapterTestUtils,
} from './qoder.js'
import type { NativeOAuthChatInput } from './types.js'

const originalRun = qoderRuntimeService.run

function input(stream = false): NativeOAuthChatInput {
  return {
    providerId: 'qoder',
    request: {
      model: 'qwen3.8-max-preview',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        type: 'function',
        function: {
          name: 'read_file',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
          },
        },
      }],
    },
    auth: {
      token: 'pt-valid-qoder-token',
      headers: {},
      providerSpecificData: {},
    },
    stream,
  }
}

afterEach(() => {
  qoderRuntimeService.run = originalRun
})

describe('Qoder native adapter', () => {
  test('maps public model ids to qodercli model levels', () => {
    expect(qoderAdapterTestUtils.modelLevel('qwen3.8-max-preview')).toBe(
      'qmodel_preview',
    )
    expect(qoderAdapterTestUtils.modelLevel('provider/glm-5.2')).toBe(
      'gm51model',
    )
    expect(qoderAdapterTestUtils.modelLevel('unknown-model')).toBe('auto')
  })

  test('returns a completion and preserves tool calls', async () => {
    let args: string[] = []
    let prompt = ''
    qoderRuntimeService.run = async (options) => {
      args = options.args
      prompt = options.input ?? ''
      return {
        code: 0,
        stdout: JSON.stringify({
          result: '<cybercode_tool_call>{"name":"read_file","arguments":{"path":"src/main.ts"}}</cybercode_tool_call>',
          is_error: false,
          usage: { input_tokens: 12, output_tokens: 5 },
        }),
        stderr: '',
      }
    }

    const result = await executeQoder(input())
    const payload = await result.response.json() as {
      choices: Array<{
        finish_reason: string
        message: {
          tool_calls: Array<{ function: { name: string; arguments: string } }>
        }
      }>
      usage: {
        prompt_tokens: number
        completion_tokens: number
      }
    }

    expect(result.response.status).toBe(200)
    expect(args).toContain('qmodel_preview')
    expect(args).toContain('--config-dir')
    expect(prompt).toContain('Available tools')
    expect(payload.choices[0]?.finish_reason).toBe('tool_calls')
    expect(payload.choices[0]?.message.tool_calls[0]?.function).toEqual({
      name: 'read_file',
      arguments: '{"path":"src/main.ts"}',
    })
    expect(payload.usage).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 5,
    })
  })

  test('returns an authentication response before opening a stream', async () => {
    qoderRuntimeService.run = async () => ({
      code: 1,
      stdout: '',
      stderr: 'invalid personal access token',
    })

    const result = await executeQoder(input(true))
    const payload = await result.response.json() as {
      error: { type: string; message: string }
    }

    expect(result.response.status).toBe(401)
    expect(result.upstreamIsStream).toBe(false)
    expect(payload.error.type).toBe('authentication_error')
    expect(payload.error.message).toContain('invalid personal access token')
  })

  test('rejects non-PAT tokens from the native transport', async () => {
    const request = input()
    request.auth.token = 'dashscope-api-key'

    const result = await executeQoder(request)

    expect(result.response.status).toBe(400)
    expect(await result.response.text()).toContain('requires a pt- Personal Access Token')
  })
})
