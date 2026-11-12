// Transport layer — OpenAI-compat + llama.cpp native fallback

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ContentPart[]
  /** Present on role=assistant when the model requested tool calls */
  tool_calls?: OpenAIToolCall[]
  /** Present on role=tool — matches tool_call_id from the assistant message */
  tool_call_id?: string
  /** Used on role=tool to indicate the tool name */
  name?: string
}

// ── OpenAI tool schema types ──────────────────────────────────────────────────

export interface OpenAITool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface ChatParams {
  messages: ChatMessage[]
  temperature?: number
  top_p?: number
  stream?: boolean
  signal?: AbortSignal
  /** When true, passes chat_template_kwargs: { enable_thinking: false } to suppress
   *  the <think> block on models that support it (Qwen3, etc. via llama.cpp). */
  noThinking?: boolean
  /** Called once when the server sends a final usage chunk with accurate token counts. */
  onUsage?: (usage: { promptTokens: number; completionTokens: number }) => void
  /**
   * Called at the start of each `/v1/chat/completions` request, including follow-up
   * requests after tool results. Used to keep live context metrics aligned with the
   * actual prompt size (the first request alone underestimates multi-tool turns).
   */
  onChatIterationStart?: (messages: ChatMessage[]) => void
  /** OpenAI-format tools to pass to the model. */
  tools?: OpenAITool[]
  /**
   * Called when the model issues a tool_call. The callback should execute the
   * tool and return the result string (or an error description). Returning null
   * means "deny / skip" — an error result is injected automatically.
   */
  onToolCall?: (call: {
    id: string
    name: string
    serverName: string
    arguments: Record<string, unknown>
  }) => Promise<{ content: string; isError: boolean } | null>
}

export interface Transport {
  chat(params: ChatParams): AsyncGenerator<string>
  health(): Promise<boolean>
  /** Returns the server's allocated context window size (n_ctx), or null if unavailable. */
  getContextSize(): Promise<number | null>
}

/** Rough prompt token estimate (~4 chars/token) including tool_calls and tool bodies. */
export function estimatePromptTokensFromMessages(messages: ChatMessage[]): number {
  const parts = messages.map((m) => {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map((p) => p.text)
            .join('')
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      return `${text}\n${JSON.stringify(m.tool_calls)}`
    }
    if (m.role === 'tool') {
      const prefix = m.name ? `${m.name}\n` : ''
      return `${prefix}${text}`
    }
    return text
  })
  return Math.ceil(parts.join('\n').length / 4)
}

// ── OpenAI-compatible transport ───────────────────────────────────────────────

class OpenAICompatTransport implements Transport {
  constructor(
    private host: string,
    private port: number,
    private apiKey?: string,
    private model: string = 'local'
  ) {}

  private get baseUrl(): string {
    const h = this.host === '0.0.0.0' ? '127.0.0.1' : this.host
    return `http://${h}:${this.port}`
  }

  async *chat(params: ChatParams): AsyncGenerator<string> {
    yield* this._chatLoop(params, [...params.messages])
  }

  private async *_chatLoop(
    params: ChatParams,
    messages: ChatMessage[]
  ): AsyncGenerator<string> {
    params.onChatIterationStart?.(messages)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    const body = JSON.stringify({
      model: this.model,
      messages,
      temperature: params.temperature,
      top_p: params.top_p,
      stream: true,
      stream_options: { include_usage: true, continuous_usage_stats: true },
      ...(params.tools && params.tools.length > 0 && { tools: params.tools }),
      ...(params.noThinking && { chat_template_kwargs: { enable_thinking: false } })
    })

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body,
      signal: params.signal
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let reasoningStarted = false
    let reasoningEnded = false
    let finished = false
    let finishReason: string | null = null

    // Accumulate tool_calls across chunks
    const pendingToolCalls: Map<number, OpenAIToolCall> = new Map()

    while (!finished) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') { finished = true; break }
        try {
          const parsed = JSON.parse(data)
          const choice = parsed?.choices?.[0]
          const delta = choice?.delta
          const reasoning: string | undefined = delta?.reasoning_content ?? delta?.reasoning
          const content: string | undefined = delta?.content
          if (choice?.finish_reason) finishReason = choice.finish_reason

          // Accumulate tool_call deltas
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls as Array<{
              index: number; id?: string; type?: string
              function?: { name?: string; arguments?: string }
            }>) {
              const existing = pendingToolCalls.get(tc.index)
              if (!existing) {
                pendingToolCalls.set(tc.index, {
                  id: tc.id ?? '',
                  type: 'function',
                  function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' }
                })
              } else {
                if (tc.id) existing.id = tc.id
                if (tc.function?.name) existing.function.name += tc.function.name
                if (tc.function?.arguments) existing.function.arguments += tc.function.arguments
              }
            }
          }

          if (reasoning && !reasoningEnded) {
            if (!reasoningStarted) { yield '<think>'; reasoningStarted = true }
            yield reasoning
          }

          if (content) {
            if (reasoningStarted && !reasoningEnded) { yield '</think>'; reasoningEnded = true }
            yield content
          }

          if (parsed.usage && params.onUsage) {
            params.onUsage({
              promptTokens: parsed.usage.prompt_tokens,
              completionTokens: parsed.usage.completion_tokens
            })
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }

    if (reasoningStarted && !reasoningEnded) yield '</think>'

    // ── Tool call loop ────────────────────────────────────────────────────────
    if (finishReason === 'tool_calls' && pendingToolCalls.size > 0 && params.onToolCall) {
      const calls = [...pendingToolCalls.values()]

      // Build the assistant message with tool_calls for the next turn
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: '',
        tool_calls: calls,
      }

      const toolResultMessages: ChatMessage[] = []

      for (const call of calls) {
        let parsedArgs: Record<string, unknown> = {}
        try { parsedArgs = JSON.parse(call.function.arguments) as Record<string, unknown> } catch { /* keep empty */ }

        // Derive serverName from the tool name prefix (server__tool) or ask callback
        const serverName = call.function.name.includes('__')
          ? call.function.name.split('__')[0]
          : call.function.name

        // Emit a marker token so the chat store can render a pending card
        yield `<tool_call id="${call.id}" name="${call.function.name}" server="${serverName}">${call.function.arguments}</tool_call>`

        const result = await params.onToolCall({
          id: call.id,
          name: call.function.name,
          serverName,
          arguments: parsedArgs,
        })

        const toolResult = result ?? { content: 'Tool call denied by user.', isError: true }

        yield `<tool_result id="${call.id}" isError="${toolResult.isError}">${toolResult.content}</tool_result>`

        toolResultMessages.push({
          role: 'tool',
          content: toolResult.content,
          tool_call_id: call.id,
          name: call.function.name,
        })
      }

      // Continue generation with the tool results
      const nextMessages = [...messages, assistantMsg, ...toolResultMessages]
      yield* this._chatLoop(params, nextMessages)
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  async getContextSize(): Promise<number | null> {
    const headers: Record<string, string> = {}
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`
    // llama.cpp: /props exposes n_ctx
    try {
      const res = await fetch(`${this.baseUrl}/props`, { signal: AbortSignal.timeout(2000), headers })
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>
        const settings = data?.default_generation_settings as Record<string, unknown> | undefined
        const n_ctx = settings?.n_ctx ?? data?.n_ctx
        if (typeof n_ctx === 'number') return n_ctx
      }
    } catch { /* fall through to vLLM probe */ }
    // vLLM: /v1/models includes max_model_len for the loaded model
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(2000), headers })
      if (res.ok) {
        const data = await res.json() as { data?: Array<Record<string, unknown>> }
        const maxLen = data?.data?.[0]?.max_model_len
        if (typeof maxLen === 'number') return maxLen
      }
    } catch { /* ignore */ }
    return null
  }
}

// ── llama.cpp native transport ────────────────────────────────────────────────

function flattenContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('')
}

class LlamaCppNativeTransport implements Transport {
  constructor(
    private host: string,
    private port: number,
    private apiKey?: string
  ) {}

  private get baseUrl(): string {
    const h = this.host === '0.0.0.0' ? '127.0.0.1' : this.host
    return `http://${h}:${this.port}`
  }

  async *chat(params: ChatParams): AsyncGenerator<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

    // Convert messages to prompt string for native endpoint
    const prompt = params.messages
      .map((m) => {
        const text = flattenContent(m.content)
        if (m.role === 'system') return `System: ${text}`
        if (m.role === 'user') return `User: ${text}`
        return `Assistant: ${text}`
      })
      .join('\n') + '\nAssistant: '

    const body = JSON.stringify({
      prompt,
      temperature: params.temperature,
      top_p: params.top_p,
      stream: true,
      n_predict: 2048
    })

    const res = await fetch(`${this.baseUrl}/completion`, {
      method: 'POST',
      headers,
      body,
      signal: params.signal
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`)
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        try {
          const parsed = JSON.parse(data)
          if (parsed.content) yield parsed.content
          if (parsed.stop) return
        } catch {
          // ignore
        }
      }
    }
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  async getContextSize(): Promise<number | null> {
    try {
      const headers: Record<string, string> = {}
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`
      const res = await fetch(`${this.baseUrl}/props`, { signal: AbortSignal.timeout(2000), headers })
      if (!res.ok) return null
      const data = await res.json() as Record<string, unknown>
      const settings = data?.default_generation_settings as Record<string, unknown> | undefined
      const n_ctx = settings?.n_ctx ?? data?.n_ctx
      return typeof n_ctx === 'number' ? n_ctx : null
    } catch {
      return null
    }
  }
}

// ── Transport resolution ──────────────────────────────────────────────────────

interface CacheEntry {
  transport: Transport
  apiKey: string | undefined
}

const transportCache = new Map<string, CacheEntry>()

export async function resolveTransport(
  host: string,
  port: number,
  apiKey?: string,
  connectionHost?: string
): Promise<Transport> {
  const key = `${host}:${port}`
  const cached = transportCache.get(key)
  // Validate API key on cache hit — a stale entry with a different key (e.g.
  // from a previous model that ran on the same port) must not be reused.
  if (cached && cached.apiKey === apiKey) return cached.transport

  // Cache miss or API-key mismatch — build a fresh transport.
  // Use connectionHost (WSL2 VM IP on Windows) for actual connections; host is display-only.
  const connHost = connectionHost ?? host
  const h = connHost === '0.0.0.0' ? '127.0.0.1' : connHost
  try {
    const probeHeaders: Record<string, string> = {}
    if (apiKey) probeHeaders['Authorization'] = `Bearer ${apiKey}`
    const res = await fetch(`http://${h}:${port}/v1/models`, {
      signal: AbortSignal.timeout(2000),
      headers: probeHeaders
    })
    if (res.ok) {
      let modelId = 'local'
      try {
        const json = await res.json() as { data?: Array<{ id: string }> }
        if (json.data?.[0]?.id) modelId = json.data[0].id
      } catch { /* ignore — fall back to 'local' */ }
      const openai = new OpenAICompatTransport(connHost, port, apiKey, modelId)
      transportCache.set(key, { transport: openai, apiKey })
      return openai
    }
  } catch {
    // fall through
  }

  const native = new LlamaCppNativeTransport(connHost, port, apiKey)
  transportCache.set(key, { transport: native, apiKey })
  return native
}

export function clearTransportCache(host: string, port: number): void {
  transportCache.delete(`${host}:${port}`)
}
