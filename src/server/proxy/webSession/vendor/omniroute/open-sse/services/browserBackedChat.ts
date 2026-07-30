export type BrowserBackedChatRequest = {
  signal?: AbortSignal | null
}

export type BrowserBackedChatResult = {
  status: number
  contentType: string | null
  body: Buffer
  isStealth: boolean
  timing: {
    acquireContextMs: number
    navigateMs: number
    submitMs: number
    captureResponseMs: number
    totalMs: number
  }
}

export async function tryBackedChat(
  request: BrowserBackedChatRequest,
): Promise<BrowserBackedChatResult> {
  if (request.signal?.aborted) {
    throw request.signal.reason instanceof Error
      ? request.signal.reason
      : new DOMException('The operation was aborted', 'AbortError')
  }
  return {
    status: 0,
    contentType: null,
    body: Buffer.alloc(0),
    isStealth: false,
    timing: {
      acquireContextMs: 0,
      navigateMs: 0,
      submitMs: 0,
      captureResponseMs: 0,
      totalMs: 0,
    },
  }
}
