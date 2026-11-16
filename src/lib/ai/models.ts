import { getSetting, setSetting, SETTING_KEYS } from '../settings'

/**
 * 고를 수 있는 Claude 모델과 요금(100만 토큰당 달러). 요금은 Anthropic API 표준 요금이며 바뀔 수 있다.
 * fallback: 안전 검사로 답을 거절했을 때 서버가 다른 모델로 다시 시도하게 할지(Haiku 5.5는 지원하지 않음).
 */
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', note: '기본 · 가장 꼼꼼함', inputPerM: 4, outputPerM: 20, fallback: true },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: '요금 절반', inputPerM: 2, outputPerM: 10, fallback: true },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', note: '가장 저렴함', inputPerM: 0.1, outputPerM: 0.5, fallback: false },
] as const

export type AiModelId = (typeof AI_MODELS)[number]['id']

export const DEFAULT_AI_MODEL: AiModelId = 'claude-opus-5-5'

export function isAiModelId(v: unknown): v is AiModelId {
  return AI_MODELS.some((m) => m.id === v)
}

export function aiModelInfo(id: string) {
  return AI_MODELS.find((m) => m.id === id)
}

export async function getAiModel(): Promise<AiModelId> {
  const v = await getSetting<unknown>(SETTING_KEYS.aiModel, DEFAULT_AI_MODEL)
  return isAiModelId(v) ? v : DEFAULT_AI_MODEL
}

/**
 * 토큰 수로 요금(달러)을 어림한다. 답한 모델을 모르면 요청한 모델의 요금을 쓴다.
 * 답한 모델 이름에 날짜 같은 꼬리가 붙어도 앞부분으로 찾는다.
 */
export function estimateCostUsd(
  usage: { input_tokens: number; output_tokens: number },
  servedModel: string,
  requestedModel: AiModelId,
): number {
  const info = AI_MODELS.find((m) => servedModel.startsWith(m.id)) ?? aiModelInfo(requestedModel)
  if (!info) return 0
  return (usage.input_tokens * info.inputPerM + usage.output_tokens * info.outputPerM) / 1_000_000
}

/** 요청 한 번에 드는 토큰 수의 어림값(생각하는 데 쓰는 출력 토큰 포함). 요청하기 전에 요금을 보여 주는 데 쓴다. */
export const TYPICAL_USAGE = {
  /** 운동 추천: 종목 4~6개, 기록 6번씩 */
  workout: { input_tokens: 4000, output_tokens: 2000 },
  /** 운동 뒤 피드백: 종목 4~6개, 기록 4번씩 */
  feedback: { input_tokens: 3000, output_tokens: 1500 },
  /** 루틴 제안: 종목 목록 80여 개와 루틴 1~4개 */
  routines: { input_tokens: 4500, output_tokens: 3000 },
} as const

/** 요청 한 번의 어림 요금. "$0.06" */
export function typicalCostText(kind: keyof typeof TYPICAL_USAGE, model: AiModelId): string {
  return formatUsd(estimateCostUsd(TYPICAL_USAGE[kind], model, model))
}

/** "$0.05", 1센트 미만이면 "$0.01 미만" */
export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return '$0.01 미만'
  return `$${v.toFixed(2)}`
}

export interface AiUsage {
  /** 'YYYY-MM' */
  month: string
  calls: number
  costUsd: number
}

function monthKey(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 이번 달 AI 사용량. 달이 바뀌면 0부터 센다. */
export async function getAiUsage(now: number = Date.now()): Promise<AiUsage> {
  const month = monthKey(now)
  const v = await getSetting<unknown>(SETTING_KEYS.aiUsage, null)
  if (
    v &&
    typeof v === 'object' &&
    (v as AiUsage).month === month &&
    typeof (v as AiUsage).calls === 'number' &&
    typeof (v as AiUsage).costUsd === 'number'
  ) {
    return v as AiUsage
  }
  return { month, calls: 0, costUsd: 0 }
}

export async function addAiUsage(costUsd: number, now: number = Date.now()): Promise<void> {
  const cur = await getAiUsage(now)
  await setSetting(SETTING_KEYS.aiUsage, { month: cur.month, calls: cur.calls + 1, costUsd: cur.costUsd + costUsd })
}
