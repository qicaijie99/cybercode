import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  copyTextMock,
  createKeyMock,
  peekStatusMock,
  revokeKeyMock,
  rotateKeyMock,
  statusMock,
  updateConfigMock,
  updateKeyMock,
} = vi.hoisted(() => ({
  copyTextMock: vi.fn(),
  createKeyMock: vi.fn(),
  peekStatusMock: vi.fn(),
  revokeKeyMock: vi.fn(),
  rotateKeyMock: vi.fn(),
  statusMock: vi.fn(),
  updateConfigMock: vi.fn(),
  updateKeyMock: vi.fn(),
}))

vi.mock('../../api/gateway', () => ({
  gatewayApi: {
    peekStatus: peekStatusMock,
    status: statusMock,
    createKey: createKeyMock,
    updateConfig: updateConfigMock,
    updateKey: updateKeyMock,
    rotateKey: rotateKeyMock,
    revokeKey: revokeKeyMock,
  },
}))

vi.mock('../chat/clipboard', () => ({
  copyTextToClipboard: copyTextMock,
}))

import { useSettingsStore } from '../../stores/settingsStore'
import type { GatewayKeyStatus, GatewayStatus } from '../../types/gateway'
import { GatewayNodePanel } from './GatewayNodePanel'

function makeKey(overrides: Partial<GatewayKeyStatus> = {}): GatewayKeyStatus {
  return {
    id: 'key-1',
    name: 'Default node key',
    prefix: 'ccn_test',
    createdAt: '2026-07-29T00:00:00.000Z',
    monthlyRequestLimit: 100,
    allowedTargets: ['model/provider-1/kimi-k2.6', 'route/coding'],
    defaultTarget: 'route/coding',
    usage: { month: '2026-07', requests: 12 },
    ...overrides,
  }
}

function makeStatus(overrides: Partial<GatewayStatus> = {}): GatewayStatus {
  return {
    baseUrl: 'http://127.0.0.1:3456/v1',
    anthropicBaseUrl: 'http://127.0.0.1:3456',
    modelsUrl: 'http://127.0.0.1:3456/v1/models',
    enabled: true,
    keys: [makeKey()],
    targets: [
      {
        id: 'model/provider-1/kimi-k2.6',
        publicId: 'kimi/kimi-k2.6',
        kind: 'model',
        label: 'kimi-k2.6',
        description: 'Kimi',
        available: true,
        providerId: 'provider-1',
        modelId: 'kimi-k2.6',
      },
      {
        id: 'route/coding',
        publicId: 'route/coding',
        kind: 'route',
        label: 'Coding',
        description: 'Quality first',
        available: true,
        routeId: 'coding',
      },
    ],
    ...overrides,
  }
}

describe('GatewayNodePanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ locale: 'en' })
    statusMock.mockReset()
    peekStatusMock.mockReset()
    peekStatusMock.mockReturnValue(undefined)
    createKeyMock.mockReset()
    updateConfigMock.mockReset()
    updateKeyMock.mockReset()
    rotateKeyMock.mockReset()
    revokeKeyMock.mockReset()
    copyTextMock.mockReset()
    copyTextMock.mockResolvedValue(true)
  })

  it('renders cached node data immediately while forcing a background refresh', async () => {
    peekStatusMock.mockReturnValue(makeStatus())
    statusMock.mockImplementation(() => new Promise(() => {}))

    render(<GatewayNodePanel />)

    expect(screen.getByText('http://127.0.0.1:3456/v1')).toBeInTheDocument()
    expect(screen.getAllByText('kimi-k2.6')).not.toHaveLength(0)
    await waitFor(() => expect(statusMock).toHaveBeenCalledWith({ force: true }))
  })

  it('keeps the page structure and connection guide visible during the first load', () => {
    statusMock.mockImplementation(() => new Promise(() => {}))

    render(<GatewayNodePanel />)

    expect(screen.getByText('Node')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connection guide' }))
    expect(screen.getByRole('dialog', { name: 'Connect another agent to CyberCode' })).toBeInTheDocument()
    expect(screen.getByText(/Protocol: choose OpenAI Compatible/)).toBeInTheDocument()
    expect(screen.getByText(/API key: enter the complete cc_/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic' }))
    expect(screen.getByText(/Base URL: enter http:\/\/127\.0\.0\.1:3456 without a trailing/)).toBeInTheDocument()
    expect(screen.getByText(/curl http:\/\/127\.0\.0\.1:3456\/v1\/messages/)).toBeInTheDocument()
    expect(screen.getByText(/"model":"auto"/)).toBeInTheDocument()
  }, 15_000)

  it('shows the endpoint and separates model targets from routes', async () => {
    statusMock.mockResolvedValue(makeStatus())

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Target policy')).toBeInTheDocument()
    expect(screen.getByText('http://127.0.0.1:3456/v1')).toBeInTheDocument()
    expect(screen.getAllByText('kimi-k2.6')).not.toHaveLength(0)
    expect(screen.getAllByText('Coding')).not.toHaveLength(0)
    expect(screen.getByText('Routes')).toBeInTheDocument()
    expect(screen.getByText('Direct models')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Connection guide' }))
    expect(screen.getByText('Default · auto → Coding')).toBeInTheDocument()
    expect(screen.getAllByText('route/coding')).not.toHaveLength(0)
    expect(screen.getAllByText('kimi/kimi-k2.6')).not.toHaveLength(0)
  }, 15_000)

  it('searches authorized targets and opens a complete connection card', async () => {
    statusMock.mockResolvedValue(makeStatus())

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Connection configuration builder')).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Search models or routes' })
    fireEvent.change(search, { target: { value: 'kimi' } })

    expect(screen.queryByRole('button', {
      name: 'Generate connection settings for route/coding',
    })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {
      name: 'Generate connection settings for kimi/kimi-k2.6',
    }))

    const dialog = screen.getByRole('dialog', { name: 'Connection settings' })
    expect(within(dialog).getByText('http://127.0.0.1:3456/v1/chat/completions')).toBeInTheDocument()
    expect(within(dialog).getByText('kimi/kimi-k2.6')).toBeInTheDocument()
    expect(within(dialog).getByText('kimi')).toBeInTheDocument()
    expect(within(dialog).getByText('ccn_test••••••••••••••••')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy all settings' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Rotate and complete' })).toBeInTheDocument()
  })

  it('switches protocol and copies every generated setting when the full key is available', async () => {
    const created = makeStatus({
      keys: [makeKey({ prefix: 'ccn_new' })],
    })
    statusMock.mockResolvedValue(makeStatus({ keys: [], enabled: false }))
    createKeyMock.mockResolvedValue({
      status: created,
      keyId: 'key-1',
      apiKey: 'ccn_new_secret_value',
    })

    render(<GatewayNodePanel />)

    fireEvent.click(await screen.findByRole('button', { name: 'Create API key' }))
    const createDialog = screen.getByRole('dialog', { name: 'Create access key' })
    fireEvent.click(within(createDialog).getByRole('button', { name: 'Create API key' }))
    await screen.findByText('ccn_new_secret_value')
    fireEvent.click(screen.getByRole('tab', { name: 'Anthropic' }))
    fireEvent.click(screen.getByRole('button', {
      name: 'Generate connection settings for kimi/kimi-k2.6',
    }))

    const dialog = screen.getByRole('dialog', { name: 'Connection settings' })
    expect(within(dialog).getByText('http://127.0.0.1:3456/v1/messages')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy all settings' }))

    await waitFor(() => expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining(
      'Protocol: Anthropic Messages',
    )))
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining(
      'API key: ccn_new_secret_value',
    ))
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining(
      'Model ID: kimi/kimi-k2.6',
    ))
  })

  it('keeps the model catalog collapsed and reveals matching models through search', async () => {
    statusMock.mockResolvedValue(makeStatus({
      targets: [
        ...makeStatus().targets,
        {
          id: 'model/provider-2/deepseek-chat',
          publicId: 'deepseek/deepseek-chat',
          kind: 'model',
          label: 'deepseek-chat',
          description: 'DeepSeek',
          available: true,
          providerId: 'provider-2',
          modelId: 'deepseek-chat',
        },
      ],
    }))

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Target policy')).toBeInTheDocument()
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Direct models: 1 / 2' }))
    expect(screen.getByRole('dialog', { name: 'Manage allowed targets' })).toBeInTheDocument()
    expect(screen.queryByText('deepseek-chat')).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox', { name: 'Search models or providers' }), {
      target: { value: 'deepseek' },
    })

    expect(screen.getByText('deepseek-chat')).toBeInTheDocument()
    const target = screen.getByRole('checkbox', { name: /deepseek-chat/i })
    expect(target).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(target)
    expect(target).toHaveAttribute('aria-checked', 'true')
  })

  it('uses a route-aware picker instead of a native select for the default target', async () => {
    statusMock.mockResolvedValue(makeStatus())

    render(<GatewayNodePanel />)

    expect(await screen.findByText('Target policy')).toBeInTheDocument()
    expect(document.querySelector('select')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('gateway-default-target'))
    expect(screen.getByRole('dialog', { name: 'Choose the auto target' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Direct models/ }))
    fireEvent.click(screen.getByRole('button', { name: /Kimi/ }))
    fireEvent.click(screen.getByRole('radio', { name: /kimi-k2.6/ }))

    expect(screen.queryByRole('dialog', { name: 'Choose the auto target' })).not.toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  }, 15_000)

  it('reveals a new key once after it is created', async () => {
    const created = makeStatus({
      keys: [makeKey({ prefix: 'ccn_new' })],
    })
    statusMock.mockResolvedValue(makeStatus({ keys: [], enabled: false }))
    createKeyMock.mockResolvedValue({
      status: created,
      keyId: 'key-1',
      apiKey: 'ccn_new_secret_value',
    })

    render(<GatewayNodePanel />)

    expect(await screen.findByText('No access key yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create API key' }))
    const dialog = screen.getByRole('dialog', { name: 'Create access key' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create API key' }))
    await waitFor(() => expect(createKeyMock).toHaveBeenCalledOnce())
    expect(createKeyMock).toHaveBeenCalledWith({ name: 'User 1' })
    expect(await screen.findByText('ccn_new_secret_value')).toBeInTheDocument()
    expect(screen.getByText('visible this time only')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy complete key' }))
    expect(copyTextMock).toHaveBeenCalledWith('ccn_new_secret_value')
  })

  it('lists multiple user keys and edits each key name independently', async () => {
    const initial = makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice', prefix: 'cc_alice' }),
        makeKey({
          id: 'key-bob',
          name: 'Bob',
          prefix: 'cc_bob',
          monthlyRequestLimit: 20,
          usage: { month: '2026-07', requests: 3 },
        }),
      ],
    })
    const renamed = makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice', prefix: 'cc_alice' }),
        makeKey({
          id: 'key-bob',
          name: 'Backend team',
          prefix: 'cc_bob',
          monthlyRequestLimit: 20,
          usage: { month: '2026-07', requests: 3 },
        }),
      ],
    })
    statusMock.mockResolvedValue(initial)
    updateKeyMock.mockResolvedValue({ status: renamed })

    render(<GatewayNodePanel />)

    const bobRow = await screen.findByTestId('gateway-key-row-key-bob')
    expect(bobRow).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(bobRow)
    expect(bobRow).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Editing access, auto target, and monthly quota for “Bob”/)).toBeInTheDocument()
    fireEvent.click(within(bobRow).getByRole('button', { name: 'Edit name' }))
    fireEvent.change(within(bobRow).getByRole('textbox', { name: 'Key name' }), {
      target: { value: 'Backend team' },
    })
    fireEvent.click(within(bobRow).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateKeyMock).toHaveBeenCalledWith('key-bob', {
      name: 'Backend team',
    }))
    expect(await screen.findByText('Backend team')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })

  it('confirms revocation and removes only the selected key', async () => {
    const initial = makeStatus({
      keys: [
        makeKey({ id: 'key-alice', name: 'Alice' }),
        makeKey({ id: 'key-bob', name: 'Bob', prefix: 'cc_bob' }),
      ],
    })
    const afterRevoke = makeStatus({
      keys: [makeKey({ id: 'key-alice', name: 'Alice' })],
    })
    statusMock.mockResolvedValue(initial)
    revokeKeyMock.mockResolvedValue({ status: afterRevoke })

    render(<GatewayNodePanel />)

    const bobRow = await screen.findByTestId('gateway-key-row-key-bob')
    fireEvent.click(within(bobRow).getByRole('button', { name: 'Revoke Bob' }))
    const dialog = screen.getByRole('dialog', { name: 'Revoke access key' })
    expect(within(dialog).getByText(/Other keys are not affected/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))

    await waitFor(() => expect(revokeKeyMock).toHaveBeenCalledWith('key-bob'))
    expect(screen.queryByText('Bob')).not.toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
  })
})
