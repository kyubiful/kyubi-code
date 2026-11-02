// Provider de OpenAI usando la suscripción de ChatGPT (backend de Codex).
import type {
  ModelInfo,
  Provider,
  ProviderEvent,
  StreamRequest,
} from '../../core/provider.ts'
import { ProviderError } from '../../core/provider.ts'
import { parseSSE } from '../sse.ts'
import { getAccessToken } from './auth.ts'
import {
  ResponsesStreamMapper,
  toResponsesInput,
  toResponsesTools,
  type ResponsesStreamEvent,
} from './convert.ts'

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'

// Los nombres cambian con el tiempo: revisa los que ofrece Codex CLI (/model)
// y añade o quita aquí. Con --model puedes usar cualquier otro id.

const MODELS: ModelInfo[] = [
  {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-6-astra',
    name: 'GPT-6 Astra',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-6.1-terra',
    name: 'GPT-6.1 Terra',
    contextWindow: 500_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-6-sol',
    name: 'GPT-6 Sol',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT-5.6 Sol',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT-5.6 Terra',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT-5.6 Luna',
    contextWindow: 272_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
  },
]

export class OpenAIProvider implements Provider {
  readonly id = 'openai'

  models(): ModelInfo[] {
    return MODELS
  }

  async *stream(
    req: StreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const body = JSON.stringify({
      model: req.model,
      instructions: req.system,
      input: toResponsesInput(req.messages),
      tools: toResponsesTools(req.tools),
      tool_choice: 'auto',
      parallel_tool_calls: true,
      reasoning: { effort: 'medium', summary: 'auto' },
      store: false, // el backend de ChatGPT no guarda conversaciones: mandamos todo cada vez
      stream: true,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: req.sessionId, // misma clave → reutiliza la caché de prompts
    })

    let res = await this.post(
      body,
      await getAccessToken(),
      req.sessionId,
      signal,
    )
    if (res.status === 401) {
      // Token revocado o caducado antes de tiempo: refrescar y reintentar una vez
      res = await this.post(
        body,
        await getAccessToken(true),
        req.sessionId,
        signal,
      )
    }
    if (!res.ok || !res.body)
      throw toProviderError(res.status, await res.text())

    let stream = res.body
    // KYUBI_RECORD_SSE=archivo.sse guarda la respuesta cruda (útil para crear fixtures)
    const recordPath = process.env.KYUBI_RECORD_SSE
    if (recordPath) {
      const [forUs, forFile] = stream.tee()
      stream = forUs
      void Bun.write(recordPath, new Response(forFile))
    }

    const mapper = new ResponsesStreamMapper()
    for await (const sse of parseSSE(stream)) {
      if (sse.data === '[DONE]') break
      yield* mapper.map(JSON.parse(sse.data) as ResponsesStreamEvent)
    }
  }

  private async post(
    body: string,
    auth: { accessToken: string; accountId?: string },
    sessionId: string | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${auth.accessToken}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'openai-beta': 'responses=experimental',
      originator: 'codex_cli_rs',
    }
    if (auth.accountId) headers['chatgpt-account-id'] = auth.accountId
    if (sessionId) headers.session_id = sessionId
    try {
      return await fetch(ENDPOINT, { method: 'POST', headers, body, signal })
    } catch (error) {
      if (signal.aborted) throw error
      throw new ProviderError(`Error de red: ${error}`, 'network', true)
    }
  }
}

function toProviderError(status: number, body: string): ProviderError {
  const message = `OpenAI respondió ${status}: ${body.slice(0, 500)}`
  if (status === 401 || status === 403)
    return new ProviderError(message, 'auth', false)
  if (status === 429) {
    // Límite de uso del plan: no sirve reintentar en unos segundos
    const usageLimit = body.includes('usage_limit')
    return new ProviderError(message, 'rate_limit', !usageLimit)
  }
  if (status >= 500) return new ProviderError(message, 'overloaded', true)
  return new ProviderError(message, 'bad_request', false)
}
