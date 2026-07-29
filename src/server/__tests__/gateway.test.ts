import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { handleGatewayApi } from '../api/gateway.js'
import { handleGatewayRequest } from '../gateway/handler.js'
import { gatewayService } from '../gateway/gatewayService.js'
import { routingService } from '../routing/routingService.js'
import { ProviderService } from '../services/providerService.js'

describe('external agent gateway', () => {
  let tempDir: string
  let originalConfigDir: string | undefined
  let upstream: ReturnType<typeof Bun.serve> | null

  beforeEach(async () => {
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cybercode-gateway-'))
    process.env.CLAUDE_CONFIG_DIR = tempDir
    ProviderService.setServerPort(3456)
    upstream = null
    routingService.resetHealth()
    await routingService.updateConfig({
      version: 1,
      enabled: true,
      profiles: [],
    })
  })

  afterEach(async () => {
    upstream?.stop(true)
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    routingService.resetHealth()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  async function setupGateway() {
    upstream = Bun.serve({
      port: 0,
      fetch: async () => Response.json({
        id: 'chatcmpl-upstream',
        object: 'chat.completion',
        created: 1,
        model: 'model-a',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'hello from provider' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
      }),
    })
    const providers = new ProviderService()
    const provider = await providers.addProvider({
      presetId: 'custom',
      name: 'Test Provider',
      apiKey: 'upstream-secret-must-not-leak',
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      apiFormat: 'openai_chat',
      models: { main: 'model-a', haiku: 'model-a', sonnet: 'model-a', opus: 'model-a' },
    })
    const created = await gatewayService.createKey(new URL('http://127.0.0.1:3456/api/gateway'))
    const modelTarget = created.status.targets.find((target) => target.providerId === provider.id)
    if (!modelTarget) throw new Error('Expected a configured gateway model target')
    return { apiKey: created.apiKey, keyId: created.keyId, modelTarget }
  }

  function request(pathname: string, apiKey: string, body?: unknown): Request {
    return new Request(`http://127.0.0.1:3456${pathname}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  test('publishes scoped model IDs without exposing upstream credentials', async () => {
    const { apiKey, modelTarget } = await setupGateway()
    const req = request('/v1/models', apiKey)
    const response = await handleGatewayRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    const payload = await response.json() as { data: Array<{ id: string }> }
    expect(payload.data.map((entry) => entry.id)).toContain(modelTarget.publicId)
    expect(JSON.stringify(payload)).not.toContain(modelTarget.providerId)
    expect(JSON.stringify(payload)).not.toContain('upstream-secret-must-not-leak')
  })

  test('keeps duplicate-provider public aliases stable after providers are removed or added', async () => {
    const providers = new ProviderService()
    const first = await providers.addProvider({
      presetId: 'custom',
      name: 'Shared Provider',
      apiKey: 'first-key',
      baseUrl: 'https://first.example.com/v1',
      apiFormat: 'openai_chat',
      models: { main: 'model-a', haiku: 'model-a', sonnet: 'model-a', opus: 'model-a' },
    })
    const second = await providers.addProvider({
      presetId: 'custom',
      name: 'Shared Provider',
      apiKey: 'second-key',
      baseUrl: 'https://second.example.com/v1',
      apiFormat: 'openai_chat',
      models: { main: 'model-b', haiku: 'model-b', sonnet: 'model-b', opus: 'model-b' },
    })

    const initial = await gatewayService.getStatus()
    const initialSecondId = initial.targets.find(
      (target) => target.providerId === second.id && target.modelId === 'model-b',
    )?.publicId
    expect(initialSecondId).toBe('second/model-b')

    await providers.deleteProvider(first.id)
    const afterDelete = await gatewayService.getStatus()
    expect(afterDelete.targets.find(
      (target) => target.providerId === second.id && target.modelId === 'model-b',
    )?.publicId).toBe(initialSecondId)

    const third = await providers.addProvider({
      presetId: 'custom',
      name: 'Shared Provider',
      apiKey: 'third-key',
      baseUrl: 'https://third.example.com/v1',
      apiFormat: 'openai_chat',
      models: { main: 'model-c', haiku: 'model-c', sonnet: 'model-c', opus: 'model-c' },
    })
    const afterAdd = await gatewayService.getStatus()
    const secondIdAfterAdd = afterAdd.targets.find(
      (target) => target.providerId === second.id && target.modelId === 'model-b',
    )?.publicId
    const thirdId = afterAdd.targets.find(
      (target) => target.providerId === third.id && target.modelId === 'model-c',
    )?.publicId

    expect(secondIdAfterAdd).toBe(initialSecondId)
    expect(thirdId).toBe('shared-provider/model-c')
    expect((await providers.getProvider(second.id)).publicAlias).toBe(
      initialSecondId?.split('/')[0],
    )
  })

  test('uses readable provider aliases for custom Chinese names and lets users override them', async () => {
    const providers = new ProviderService()
    const volcengine = await providers.addProvider({
      presetId: 'custom',
      name: '火山',
      apiKey: 'volcengine-key',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
      apiFormat: 'openai_chat',
      models: { main: 'glm-5.1', haiku: 'glm-5.1', sonnet: 'glm-5.1', opus: 'glm-5.1' },
    })
    const qianfan = await providers.addProvider({
      presetId: 'custom',
      name: '百度千帆',
      apiKey: 'qianfan-key',
      baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
      apiFormat: 'anthropic',
      models: { main: 'glm-5.1', haiku: 'glm-5.1', sonnet: 'glm-5.1', opus: 'glm-5.1' },
    })

    expect(volcengine.publicAlias).toBe('volcengine')
    expect(qianfan.publicAlias).toBe('qianfan')

    const renamed = await providers.updateProvider(qianfan.id, {
      publicAlias: 'baidu-main',
    })
    expect(renamed.publicAlias).toBe('baidu-main')
    await expect(providers.updateProvider(volcengine.id, {
      publicAlias: 'baidu-main',
    })).rejects.toMatchObject({ statusCode: 409 })

    const status = await gatewayService.getStatus()
    expect(status.targets.find(
      (target) => target.providerId === volcengine.id && target.modelId === 'glm-5.1',
    )?.publicId).toBe('volcengine/glm-5.1')
    expect(status.targets.find(
      (target) => target.providerId === qianfan.id && target.modelId === 'glm-5.1',
    )?.publicId).toBe('baidu-main/glm-5.1')
  })

  test('migrates legacy custom hash aliases to readable provider aliases', async () => {
    const cybercodeDir = path.join(tempDir, 'cybercode')
    await fs.mkdir(cybercodeDir, { recursive: true })
    await fs.writeFile(path.join(cybercodeDir, 'providers.json'), JSON.stringify({
      activeId: null,
      providers: [
        {
          id: 'legacy-volcengine',
          presetId: 'custom',
          publicAlias: 'custom',
          name: '火山',
          apiKey: 'volcengine-key',
          baseUrl: 'https://ark.cn-beijing.volces.com/api/plan',
          apiFormat: 'openai_chat',
          models: { main: 'glm-5.1', haiku: 'glm-5.1', sonnet: 'glm-5.1', opus: 'glm-5.1' },
        },
        {
          id: 'legacy-qianfan',
          presetId: 'custom',
          publicAlias: 'custom-138aa4',
          name: '百度千帆',
          apiKey: 'qianfan-key',
          baseUrl: 'https://qianfan.baidubce.com/anthropic/coding',
          apiFormat: 'anthropic',
          models: { main: 'glm-5.1', haiku: 'glm-5.1', sonnet: 'glm-5.1', opus: 'glm-5.1' },
        },
      ],
    }))

    const providers = new ProviderService()
    const migrated = await providers.listProviders()

    expect(migrated.providers.map((provider) => provider.publicAlias)).toEqual([
      'volcengine',
      'qianfan',
    ])
  })

  test('exposes complete multi-key lifecycle routes through the local API', async () => {
    const createRequest = new Request('http://127.0.0.1:3456/api/gateway/keys', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Mobile user', monthlyRequestLimit: 40 }),
    })
    const createdResponse = await handleGatewayApi(
      createRequest,
      new URL(createRequest.url),
      ['api', 'gateway', 'keys'],
    )
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json() as {
      keyId: string
      apiKey: string
      status: { keys: Array<{ id: string; name: string; monthlyRequestLimit: number }> }
    }
    expect(created.apiKey).toStartWith('cc_')
    expect(created.status.keys[0]).toMatchObject({
      id: created.keyId,
      name: 'Mobile user',
      monthlyRequestLimit: 40,
    })

    const updateRequest = new Request(
      `http://127.0.0.1:3456/api/gateway/keys/${created.keyId}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Tablet user' }),
      },
    )
    const updatedResponse = await handleGatewayApi(
      updateRequest,
      new URL(updateRequest.url),
      ['api', 'gateway', 'keys', created.keyId],
    )
    expect(updatedResponse.status).toBe(200)
    await expect(updatedResponse.json()).resolves.toMatchObject({
      status: { keys: [{ id: created.keyId, name: 'Tablet user' }] },
    })

    const rotateRequest = new Request(
      `http://127.0.0.1:3456/api/gateway/keys/${created.keyId}/rotate`,
      { method: 'POST' },
    )
    const rotatedResponse = await handleGatewayApi(
      rotateRequest,
      new URL(rotateRequest.url),
      ['api', 'gateway', 'keys', created.keyId, 'rotate'],
    )
    expect(rotatedResponse.status).toBe(200)
    const rotated = await rotatedResponse.json() as { apiKey: string }
    expect(rotated.apiKey).toStartWith('cc_')
    expect(rotated.apiKey).not.toBe(created.apiKey)

    const revokeRequest = new Request(
      `http://127.0.0.1:3456/api/gateway/keys/${created.keyId}`,
      { method: 'DELETE' },
    )
    const revokedResponse = await handleGatewayApi(
      revokeRequest,
      new URL(revokeRequest.url),
      ['api', 'gateway', 'keys', created.keyId],
    )
    expect(revokedResponse.status).toBe(200)
    await expect(revokedResponse.json()).resolves.toMatchObject({
      status: { enabled: false, keys: [] },
    })
  })

  test('marks only configured runtime targets available and scopes new keys accordingly', async () => {
    const providers = new ProviderService()
    const missingCredential = await providers.addProvider({
      presetId: 'custom',
      name: 'Missing credential',
      apiKey: '',
      baseUrl: 'https://models.example.com/v1',
      apiFormat: 'openai_chat',
      models: {
        main: 'cloud-model',
        haiku: 'cloud-model',
        sonnet: 'cloud-model',
        opus: 'cloud-model',
      },
    })
    const local = await providers.addProvider({
      presetId: 'ollama',
      name: 'Local model',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434',
      apiFormat: 'anthropic',
      models: {
        main: 'qwen3:8b',
        haiku: 'qwen3:8b',
        sonnet: 'qwen3:8b',
        opus: 'qwen3:8b',
      },
    })

    const created = await gatewayService.createKey(
      new URL('http://127.0.0.1:3456/api/gateway'),
    )
    const missingTarget = created.status.targets.find(
      (target) => target.providerId === missingCredential.id,
    )
    const localTarget = created.status.targets.find(
      (target) => target.providerId === local.id,
    )

    expect(missingTarget?.available).toBe(false)
    expect(localTarget?.available).toBe(true)
    expect(created.status.keys[0]?.allowedTargets).not.toContain(missingTarget?.id)
    expect(created.status.keys[0]?.allowedTargets).toContain(localTarget?.id)
  })

  test('forwards an allowed model through the node and preserves OpenAI response shape', async () => {
    const { apiKey, modelTarget } = await setupGateway()
    const req = request('/v1/chat/completions', apiKey, {
      model: modelTarget.publicId,
      messages: [{ role: 'user', content: 'Hi' }],
    })
    const response = await handleGatewayRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-cybercode-target')).toBe(modelTarget.id)
    await expect(response.json()).resolves.toMatchObject({
      object: 'chat.completion',
      model: modelTarget.publicId,
      choices: [{ message: { role: 'assistant', content: 'hello from provider' } }],
    })
  })

  test('keeps legacy internal model IDs working without advertising them', async () => {
    const { apiKey, modelTarget } = await setupGateway()
    const req = request('/v1/chat/completions', apiKey, {
      model: modelTarget.id,
      messages: [{ role: 'user', content: 'Hi from a saved legacy client' }],
    })
    const response = await handleGatewayRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-cybercode-target')).toBe(modelTarget.id)
    await expect(response.json()).resolves.toMatchObject({
      model: modelTarget.id,
      choices: [{ message: { role: 'assistant', content: 'hello from provider' } }],
    })
  })

  test('accepts Anthropic Messages requests from external agents', async () => {
    const { apiKey, modelTarget } = await setupGateway()
    const req = new Request('http://127.0.0.1:3456/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: modelTarget.publicId,
        max_tokens: 256,
        messages: [{ role: 'user', content: 'Hi from an Anthropic client' }],
      }),
    })
    const response = await handleGatewayRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-cybercode-target')).toBe(modelTarget.id)
    await expect(response.json()).resolves.toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'hello from provider' }],
    })
  })

  test('forwards Anthropic-compatible model targets through the external node', async () => {
    let forwardedApiKey: string | null = null
    let forwardedPath = ''
    let forwardedModel = ''
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        forwardedApiKey = request.headers.get('x-api-key')
        forwardedPath = new URL(request.url).pathname
        const body = await request.json() as { model?: string }
        forwardedModel = body.model ?? ''
        return Response.json({
          id: 'msg-native',
          type: 'message',
          role: 'assistant',
          model: body.model,
          content: [{ type: 'text', text: 'native reply' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 5, output_tokens: 2 },
        })
      },
    })
    const providers = new ProviderService()
    const provider = await providers.addProvider({
      presetId: 'custom',
      name: 'Native Anthropic',
      apiKey: 'native-provider-key',
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      apiFormat: 'anthropic',
      models: {
        main: 'native-model',
        haiku: 'native-model',
        sonnet: 'native-model',
        opus: 'native-model',
      },
    })
    const created = await gatewayService.createKey(
      new URL('http://127.0.0.1:3456/api/gateway'),
    )
    const target = created.status.targets.find((entry) => entry.providerId === provider.id)
    if (!target) throw new Error('Expected an Anthropic gateway target')

    const req = request('/v1/chat/completions', created.apiKey, {
      model: target.publicId,
      messages: [{ role: 'user', content: 'Hi' }],
    })
    const response = await handleGatewayRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(forwardedApiKey).toBe('native-provider-key')
    expect(forwardedPath).toBe('/v1/messages')
    expect(forwardedModel).toBe('native-model')
    await expect(response.json()).resolves.toMatchObject({
      model: target.publicId,
      choices: [{ message: { content: 'native reply' } }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    })
  })

  test('runs a smart route through the node, fails over once, and charges one request', async () => {
    const seenKeys: string[] = []
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const authorization = request.headers.get('authorization') ?? ''
        seenKeys.push(authorization)
        const body = await request.json() as { model?: string }
        if (authorization === 'Bearer route-rate-limited') {
          return Response.json({ error: { message: 'rate limited' } }, { status: 429 })
        }
        return Response.json({
          id: 'chatcmpl-route-node',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'route recovered' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 6, completion_tokens: 3, total_tokens: 9 },
        })
      },
    })
    const providers = new ProviderService()
    const first = await providers.addProvider({
      presetId: 'custom',
      name: 'Primary route source',
      apiKey: 'route-rate-limited',
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      apiFormat: 'openai_chat',
      models: {
        main: 'primary-model',
        haiku: 'primary-model',
        sonnet: 'primary-model',
        opus: 'primary-model',
      },
    })
    const second = await providers.addProvider({
      presetId: 'custom',
      name: 'Fallback route source',
      apiKey: 'route-healthy',
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      apiFormat: 'openai_chat',
      models: {
        main: 'fallback-model',
        haiku: 'fallback-model',
        sonnet: 'fallback-model',
        opus: 'fallback-model',
      },
    })
    await routingService.updateConfig({
      version: 1,
      enabled: true,
      profiles: [{
        id: 'coding',
        name: 'Coding',
        enabled: true,
        strategy: 'priority',
        strictFree: false,
        allowExperimental: false,
        maxAttempts: 2,
        targets: [
          { providerId: first.id, priority: 0 },
          { providerId: second.id, priority: 1 },
        ],
      }],
    })
    const created = await gatewayService.createKey(
      new URL('http://127.0.0.1:3456/api/gateway'),
    )
    const routeTarget = created.status.targets.find((target) => target.id === 'route/coding')
    if (!routeTarget) throw new Error('Expected a route gateway target')
    await gatewayService.updateKey(created.keyId, {
      monthlyRequestLimit: 10,
      allowedTargets: [routeTarget.id],
      defaultTarget: routeTarget.id,
    })

    const req = request('/v1/chat/completions', created.apiKey, {
      model: 'auto',
      messages: [{ role: 'user', content: 'Complete this task' }],
    })
    const response = await handleGatewayRequest(req, new URL(req.url))

    expect(response.status).toBe(200)
    expect(response.headers.get('x-cybercode-target')).toBe('route/coding')
    expect(response.headers.get('x-cybercode-resolved-model')).toBe('fallback-model')
    expect(seenKeys).toEqual([
      'Bearer route-rate-limited',
      'Bearer route-healthy',
    ])
    await expect(response.json()).resolves.toMatchObject({
      model: 'auto',
      choices: [{ message: { content: 'route recovered' } }],
    })
    const status = await gatewayService.getStatus()
    expect(status.keys[0]?.usage.requests).toBe(1)
    const dashboard = await routingService.getDashboard()
    const routeEvents = dashboard.events.filter((event) => event.routeId === 'coding')
    expect(routeEvents).toHaveLength(2)
    expect(routeEvents.map((event) => event.status).sort()).toEqual(['failed', 'success'])
  })

  test('preserves OpenAI streaming semantics through a smart route', async () => {
    upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        return new Response([
          'data: {"id":"route-stream","object":"chat.completion.chunk","created":1,"model":"stream-model","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
          'data: {"id":"route-stream","object":"chat.completion.chunk","created":1,"model":"stream-model","choices":[{"index":0,"delta":{"content":"streamed reply"},"finish_reason":null}]}\n\n',
          'data: {"id":"route-stream","object":"chat.completion.chunk","created":1,"model":"stream-model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: [DONE]\n\n',
        ].join(''), {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    })
    const providers = new ProviderService()
    const provider = await providers.addProvider({
      presetId: 'custom',
      name: 'Streaming source',
      apiKey: 'stream-key',
      baseUrl: `http://127.0.0.1:${upstream.port}/v1`,
      apiFormat: 'openai_chat',
      models: {
        main: 'stream-model',
        haiku: 'stream-model',
        sonnet: 'stream-model',
        opus: 'stream-model',
      },
    })
    await routingService.updateConfig({
      version: 1,
      enabled: true,
      profiles: [{
        id: 'streaming',
        name: 'Streaming',
        enabled: true,
        strategy: 'priority',
        strictFree: false,
        allowExperimental: false,
        maxAttempts: 1,
        targets: [{ providerId: provider.id }],
      }],
    })
    const created = await gatewayService.createKey(
      new URL('http://127.0.0.1:3456/api/gateway'),
    )
    await gatewayService.updateKey(created.keyId, {
      monthlyRequestLimit: 0,
      allowedTargets: ['route/streaming'],
      defaultTarget: 'route/streaming',
    })

    const req = request('/v1/chat/completions', created.apiKey, {
      model: 'auto',
      stream: true,
      messages: [{ role: 'user', content: 'Stream this task' }],
    })
    const response = await handleGatewayRequest(req, new URL(req.url))
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(response.headers.get('x-cybercode-resolved-model')).toBe('stream-model')
    expect(body).toContain('"content":"streamed reply"')
    expect(body).toContain('data: [DONE]')
  })

  test('serializes concurrent quota consumption so only one request uses the final slot', async () => {
    const { apiKey, keyId, modelTarget } = await setupGateway()
    await gatewayService.updateKey(keyId, {
      monthlyRequestLimit: 1,
      allowedTargets: [modelTarget.id],
      defaultTarget: modelTarget.id,
    })

    const responses = await Promise.all(Array.from({ length: 8 }, (_, index) => {
      const req = request('/v1/chat/completions', apiKey, {
        model: modelTarget.publicId,
        messages: [{ role: 'user', content: `Concurrent ${index}` }],
      })
      return handleGatewayRequest(req, new URL(req.url))
    }))

    expect(responses.filter((response) => response.status === 200)).toHaveLength(1)
    expect(responses.filter((response) => response.status === 429)).toHaveLength(7)
    expect((await gatewayService.getStatus()).keys[0]?.usage.requests).toBe(1)
  })

  test('rotates one key without resetting its scope or monthly usage', async () => {
    const { apiKey, keyId, modelTarget } = await setupGateway()
    await gatewayService.updateKey(keyId, {
      monthlyRequestLimit: 2,
      allowedTargets: [modelTarget.id],
      defaultTarget: modelTarget.id,
    })
    const first = request('/v1/chat/completions', apiKey, {
      model: modelTarget.publicId,
      messages: [{ role: 'user', content: 'Count this request' }],
    })
    expect((await handleGatewayRequest(first, new URL(first.url))).status).toBe(200)

    const rotated = await gatewayService.rotateKey(
      keyId,
      new URL('http://127.0.0.1:3456/api/gateway'),
    )
    const key = rotated.status.keys.find((entry) => entry.id === keyId)

    expect(key?.allowedTargets).toEqual([modelTarget.id])
    expect(key?.defaultTarget).toBe(modelTarget.id)
    expect(key?.monthlyRequestLimit).toBe(2)
    expect(key?.usage.requests).toBe(1)
    expect((await gatewayService.authenticate(request('/v1/models', rotated.apiKey))).key.id).toBe(keyId)
    await expect(
      gatewayService.authenticate(request('/v1/models', apiKey)),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_API_KEY' })
  })

  test('rechecks current node scope before consuming an authenticated request', async () => {
    const { apiKey, keyId, modelTarget } = await setupGateway()
    const authenticated = await gatewayService.authenticate(
      request('/v1/models', apiKey),
    )
    const scoped = await gatewayService.updateKey(keyId, {
      monthlyRequestLimit: 0,
      allowedTargets: [],
    })
    expect(scoped.keys.find((key) => key.id === keyId)?.defaultTarget).toBeUndefined()

    await expect(
      gatewayService.resolveAuthorizedTarget(authenticated.key, modelTarget.publicId),
    ).rejects.toMatchObject({ statusCode: 403, code: 'MODEL_NOT_ALLOWED' })
    await expect(
      gatewayService.consumeRequest(authenticated.key, modelTarget.id),
    ).rejects.toMatchObject({ statusCode: 403, code: 'MODEL_NOT_ALLOWED' })
    expect((await gatewayService.getStatus()).keys[0]?.usage.requests).toBe(0)
  })

  test('rejects unauthorized targets and enforces the node request quota', async () => {
    const { apiKey, keyId, modelTarget } = await setupGateway()
    const status = await gatewayService.getStatus(new URL('http://127.0.0.1:3456/api/gateway'))
    await gatewayService.updateKey(keyId, {
      monthlyRequestLimit: 1,
      allowedTargets: [modelTarget.id],
      defaultTarget: modelTarget.id,
    }, new URL('http://127.0.0.1:3456/api/gateway'))

    const denied = request('/v1/chat/completions', apiKey, {
      model: 'route/not-authorized',
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect((await handleGatewayRequest(denied, new URL(denied.url))).status).toBe(403)

    const invalid = request('/v1/chat/completions', apiKey, {
      model: modelTarget.publicId,
      messages: [],
    })
    expect((await handleGatewayRequest(invalid, new URL(invalid.url))).status).toBe(400)

    const first = request('/v1/chat/completions', apiKey, {
      model: modelTarget.publicId,
      messages: [{ role: 'user', content: 'Hi' }],
    })
    expect((await handleGatewayRequest(first, new URL(first.url))).status).toBe(200)

    const quotaReached = request('/v1/chat/completions', apiKey, {
      model: modelTarget.publicId,
      messages: [{ role: 'user', content: 'Again' }],
    })
    const response = await handleGatewayRequest(quotaReached, new URL(quotaReached.url))
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'QUOTA_EXCEEDED' },
    })

    const rotated = await gatewayService.rotateKey(
      keyId,
      new URL('http://127.0.0.1:3456/api/gateway'),
    )
    expect(rotated.status.keys[0]?.usage.requests).toBe(1)
    const afterRotation = request('/v1/chat/completions', rotated.apiKey, {
      model: modelTarget.publicId,
      messages: [{ role: 'user', content: 'Still limited' }],
    })
    expect((await handleGatewayRequest(afterRotation, new URL(afterRotation.url))).status).toBe(429)
    expect(status.keys[0]?.allowedTargets).toContain(modelTarget.id)
  })

  test('keeps scope, quota, usage, rotation, and revocation isolated per key', async () => {
    const first = await setupGateway()
    await gatewayService.updateKey(first.keyId, {
      name: 'Alice',
      monthlyRequestLimit: 1,
      allowedTargets: [first.modelTarget.id],
      defaultTarget: first.modelTarget.id,
    })
    const second = await gatewayService.createKey({
      name: 'Bob',
      monthlyRequestLimit: 2,
      allowedTargets: [first.modelTarget.id],
      defaultTarget: first.modelTarget.id,
    })

    const aliceRequest = request('/v1/chat/completions', first.apiKey, {
      model: first.modelTarget.publicId,
      messages: [{ role: 'user', content: 'Alice request' }],
    })
    const bobRequest = request('/v1/chat/completions', second.apiKey, {
      model: first.modelTarget.publicId,
      messages: [{ role: 'user', content: 'Bob request' }],
    })
    expect((await handleGatewayRequest(aliceRequest, new URL(aliceRequest.url))).status).toBe(200)
    expect((await handleGatewayRequest(bobRequest, new URL(bobRequest.url))).status).toBe(200)

    let status = await gatewayService.getStatus()
    expect(status.keys.find((key) => key.id === first.keyId)?.usage.requests).toBe(1)
    expect(status.keys.find((key) => key.id === second.keyId)?.usage.requests).toBe(1)

    const aliceQuota = request('/v1/chat/completions', first.apiKey, {
      model: first.modelTarget.publicId,
      messages: [{ role: 'user', content: 'Alice exceeds her quota' }],
    })
    expect((await handleGatewayRequest(aliceQuota, new URL(aliceQuota.url))).status).toBe(429)

    status = await gatewayService.revokeKey(first.keyId)
    expect(status.enabled).toBe(true)
    expect(status.keys.map((key) => key.name)).toEqual(['Bob'])
    expect((await gatewayService.authenticate(request('/v1/models', second.apiKey))).key.id).toBe(second.keyId)
    await expect(
      gatewayService.authenticate(request('/v1/models', first.apiKey)),
    ).rejects.toMatchObject({ statusCode: 401, code: 'INVALID_API_KEY' })
  })

  test('migrates an existing single-key config without losing its secret or usage', async () => {
    const created = await setupGateway()
    const configPath = path.join(tempDir, 'cybercode', 'gateway.json')
    const current = JSON.parse(await fs.readFile(configPath, 'utf-8')) as {
      enabled: boolean
      keys: Array<Record<string, unknown> & {
        usage?: { month: string; requests: number }
      }>
    }
    const legacyKey = { ...current.keys[0] }
    const usage = legacyKey.usage
    delete legacyKey.usage
    delete legacyKey.name
    await fs.writeFile(configPath, JSON.stringify({
      version: 1,
      enabled: current.enabled,
      key: legacyKey,
      usage: { month: usage?.month, requests: 7 },
    }))

    let status = await gatewayService.getStatus()
    expect(status.keys).toHaveLength(1)
    expect(status.keys[0]?.id).toBe(created.keyId)
    expect(status.keys[0]?.name).toBe('Default node key')
    expect(status.keys[0]?.usage.requests).toBe(7)
    expect((await gatewayService.authenticate(request('/v1/models', created.apiKey))).key.id).toBe(created.keyId)

    status = await gatewayService.updateKey(created.keyId, { name: 'Migrated user' })
    expect(status.keys[0]?.name).toBe('Migrated user')
    const migrated = JSON.parse(await fs.readFile(configPath, 'utf-8')) as { version: number }
    expect(migrated.version).toBe(2)
  })
})
