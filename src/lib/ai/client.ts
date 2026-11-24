import type AnthropicClient from '@anthropic-ai/sdk'
import { aiModelInfo, estimateCostUsd, type AiModelId } from './models'

/**
 * Claude API를 폰의 브라우저에서 바로 부른다(서버 없음). API 키는 사용자가 설정에 넣은 것을 쓰고 폰 밖으로 보내지 않는다.
 * SDK는 AI 기능을 쓸 때만 내려받도록 나눠서 불러온다.
 */

export type AiErrorKind = 'auth' | 'permission' | 'model' | 'rate' | 'server' | 'network' | 'refusal' | 'truncated' | 'invalid' | 'request'

/** 화면에 그대로 보여 줄 수 있는 한국어 오류 */
export class AiError extends Error {
  readonly kind: AiErrorKind
  /** 더 자세한 내용(영문일 수 있음). 작게 보여 준다. */
  readonly detail?: string
  /** 답은 받았지만 쓸 수 없었을 때(잘림, 거절, 읽지 못함) 그 요청에 든 어림 요금. 사용량에 더한다. */
  readonly costUsd?: number

  constructor(message: string, kind: AiErrorKind, detail?: string, costUsd?: number) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
    this.detail = detail
    this.costUsd = costUsd
  }
}

type Sdk = typeof AnthropicClient

let sdkPromise: Promise<Sdk> | null = null
function loadSdk(): Promise<Sdk> {
  // 내려받기가 한 번 실패해도(인터넷이 끊기거나 새 버전으로 바뀌는 중) 다음 요청에서 다시 받는다.
  sdkPromise ??= import('@anthropic-ai/sdk')
    .then((m) => m.default)
    .catch((e: unknown) => {
      sdkPromise = null
      throw new AiError('AI 기능을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.', 'network', String(e))
    })
  return sdkPromise
}

/** 답이 끝까지 오지 않을 때 기다리는 최대 시간. 스트리밍이라 SDK의 timeout은 첫 응답까지만 본다. */
export const ANSWER_TIMEOUT_MS = 4 * 60_000

export async function createClient(apiKey: string): Promise<{ Anthropic: Sdk; client: AnthropicClient }> {
  const Anthropic = await loadSdk()
  // 사용자 자신의 키를 자신의 폰에서만 쓰는 앱이라 브라우저에서 바로 부른다.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 120_000, maxRetries: 1 })
  return { Anthropic, client }
}

export function assertOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AiError('인터넷에 연결되어 있지 않습니다. 연결된 뒤 다시 시도해 주세요.', 'network')
  }
}

/** 오류 아래 작게 보일 원문. API 오류는 JSON 본문 대신 "401 · invalid x-api-key"처럼 줄인다. */
function errorDetail(e: unknown, Anthropic: Sdk): string | undefined {
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: unknown } } | undefined
    const message = typeof body?.error?.message === 'string' ? body.error.message : undefined
    if (message) return e.status ? `${e.status} · ${message}` : message
  }
  return e instanceof Error ? e.message : undefined
}

/** SDK 오류를 한국어 안내로 바꾼다. 구체적인 종류부터 확인한다. */
export function toAiError(e: unknown, Anthropic: Sdk): AiError {
  if (e instanceof AiError) return e
  const detail = errorDetail(e, Anthropic)
  if (e instanceof Anthropic.AuthenticationError) {
    return new AiError('API 키가 맞지 않습니다. 설정에서 키를 다시 확인해 주세요.', 'auth', detail)
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new AiError('이 API 키로는 이 모델을 쓸 수 없습니다. 설정에서 다른 모델을 골라 보세요.', 'permission', detail)
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new AiError('모델을 찾을 수 없습니다. 설정에서 다른 모델을 골라 주세요.', 'model', detail)
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new AiError('요청이 많아 잠시 막혔습니다. 1~2분 뒤에 다시 시도해 주세요.', 'rate', detail)
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new AiError(
      'Anthropic이 요청을 받지 않았습니다. API 크레딧 잔액이 부족해도 이렇게 될 수 있으니 콘솔에서 확인해 주세요.',
      'request',
      detail,
    )
  }
  if (e instanceof Anthropic.InternalServerError) {
    return new AiError('Anthropic 서버가 바쁩니다. 잠시 뒤에 다시 시도해 주세요.', 'server', detail)
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError || e instanceof Anthropic.APIUserAbortError) {
    return new AiError('답이 너무 오래 걸려 멈췄습니다. 다시 시도해 주세요.', 'network', detail)
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new AiError('Anthropic에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'network', detail)
  }
  if (e instanceof Anthropic.APIError) {
    return new AiError(`요청이 실패했습니다(${e.status ?? '알 수 없음'}). 잠시 뒤에 다시 시도해 주세요.`, 'server', detail)
  }
  return new AiError('AI 요청 중에 문제가 생겼습니다. 다시 시도해 주세요.', 'request', detail)
}

export interface JsonRequest {
  apiKey: string
  model: AiModelId
  system: string
  prompt: string
  /** 답이 따라야 할 JSON 스키마(구조화된 출력) */
  schema: Record<string, unknown>
}

export interface JsonResponse {
  value: unknown
  /** 실제로 답한 모델(거절로 다른 모델이 이어 답했을 수 있음) */
  servedModel: string
  costUsd: number
  inputTokens: number
  outputTokens: number
}

type ContentBlock = { type: string; text?: string }

/**
 * 답의 JSON 글. 거절로 다른 모델이 이어 답했으면 content에 fallback 블록이 끼고, 스트리밍에서는 그 앞에
 * 거절한 모델이 쓰다 만 글이 남는다. 그래서 마지막 fallback 블록 뒤의 text만 이어 붙인다.
 */
export function answerText(content: ContentBlock[]): string {
  let start = 0
  content.forEach((b, i) => {
    if (b.type === 'fallback') start = i + 1
  })
  return content
    .slice(start)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

interface UsageLike {
  input_tokens: number
  output_tokens: number
  iterations?: Array<{ type: string; input_tokens: number; output_tokens: number; model?: string | null }> | null
}

/** 요금 어림값. 다른 모델이 이어 답했으면 시도마다 그 모델의 요금으로 센다(맨 위 usage는 마지막 시도만 담는다). */
export function costOfUsage(usage: UsageLike, servedModel: string, requestedModel: AiModelId): number {
  const attempts = (usage.iterations ?? []).filter((it) => it.type === 'message' || it.type === 'fallback_message')
  if (attempts.length === 0) return estimateCostUsd(usage, servedModel, requestedModel)
  return attempts.reduce((sum, it) => sum + estimateCostUsd(it, it.model ?? servedModel, requestedModel), 0)
}

/** Claude에게 묻고 JSON 답을 받는다. 실패하면 AiError를 던진다. */
export async function askClaudeJson(req: JsonRequest): Promise<JsonResponse> {
  assertOnline()
  const { Anthropic, client } = await createClient(req.apiKey)
  const info = aiModelInfo(req.model)

  // 생각하는 시간이 길 수 있어 스트리밍으로 받고 다 모인 답만 쓴다(중간에 끊겨도 재시도로 두 번 청구되지 않게).
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), ANSWER_TIMEOUT_MS)
  let response: AnthropicClient.Beta.BetaMessage
  try {
    response = await client.beta.messages
      .stream(
        {
          model: req.model,
          max_tokens: 16000,
          // 안전 검사로 거절되면 서버가 알맞은 다른 모델로 이어서 답하게 한다(지원하는 모델만).
          ...(info?.fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
          system: req.system,
          messages: [{ role: 'user', content: req.prompt }],
        },
        { signal: abort.signal },
      )
      .finalMessage()
  } catch (e) {
    throw toAiError(e, Anthropic)
  } finally {
    clearTimeout(timer)
  }

  // 답을 쓰지 못하는 경우에도 요금은 들었으니, 오류에 실어 보내 사용량에 더하게 한다.
  const costUsd = costOfUsage(response.usage, response.model, req.model)
  if (response.stop_reason === 'refusal') {
    throw new AiError('AI가 이 요청에는 답하지 않았습니다.', 'refusal', response.stop_details?.explanation ?? undefined, costUsd)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new AiError('AI 답이 너무 길어 잘렸습니다. 다시 시도해 주세요.', 'truncated', undefined, costUsd)
  }
  let value: unknown
  try {
    value = JSON.parse(answerText(response.content))
  } catch {
    throw new AiError('AI 답을 읽지 못했습니다. 다시 시도해 주세요.', 'invalid', undefined, costUsd)
  }

  return {
    value,
    servedModel: response.model,
    costUsd,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  }
}

/** 키와 모델을 쓸 수 있는지 확인한다(모델 정보만 읽어서 요금이 들지 않는다). 모델의 표시 이름을 돌려준다. */
export async function checkConnection(apiKey: string, model: AiModelId): Promise<string> {
  assertOnline()
  const { Anthropic, client } = await createClient(apiKey)
  try {
    const info = await client.models.retrieve(model)
    return info.display_name
  } catch (e) {
    throw toAiError(e, Anthropic)
  }
}
