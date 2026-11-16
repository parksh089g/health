import { db, type AiAdvice, type AiExerciseSuggestion, type AiReview, type AiWorkoutAdvice } from '../../db'
import { getAiApiKey } from '../settings'
import { AiError, askClaudeJson } from './client'
import { buildReviewContext, buildWorkoutContext, type WorkoutContextItem } from './context'
import { addAiUsage, getAiModel } from './models'

/** 오늘 운동 추천을 저장하는 id */
export const workoutAdviceId = (workoutId: string) => `workout:${workoutId}`
export const REVIEW_ADVICE_ID = 'review'

// ───────── 운동 추천

export const WORKOUT_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자가 오늘 할 종목과 최근 기록을 보고, 종목마다 아직 하지 않은 본 세트에 쓸 무게와 횟수를 하나씩 제안합니다. 사용자는 운동 중에 폰으로 이 답을 보고, 마음에 들면 눌러서 세트에 채웁니다.

어떻게 정할지:
- 앱의 규칙 추천(목표 횟수를 모든 본 세트에서 채우면 증량 단위만큼 올리고, 못 채우면 같은 무게)을 출발점으로 삼으세요. 기록의 흐름(정체, 빠른 성장, 오래 쉰 기간, 메모에 적힌 컨디션, 오늘 이미 끝낸 세트)을 보고 더 나은 값이 있으면 바꿔도 됩니다.
- 무게는 한 번에 크게 올리지 말고, 그 종목의 증량 단위의 배수로 맞추세요.
- 오랜만에 하는 운동이거나 메모에 통증이나 피로가 있으면 보수적으로 정하세요.
- 맨몸 종목은 weightKg를 null로 두고 횟수만 정하세요.
- 지난 기록이 없는 종목은 오늘 세트에 적힌 값을 따르세요. 무게가 비어 있으면 weightKg를 null로 두고, 가벼운 무게로 자세를 익히라고 이유에 적으세요.
- 오늘 본 세트를 이미 모두 끝낸 종목도 넣고, 이유에는 다음 운동 때의 기준을 적으세요.

어떻게 쓸지:
- exercises에는 오늘 할 종목을 받은 key 그대로 하나씩 모두 넣습니다.
- reason은 그 값을 고른 까닭을 한국어 해요체 한 문장(40자 안팎)으로 씁니다.
- summary는 오늘 운동 전체에 대한 조언을 한국어 해요체 한두 문장으로 씁니다.
- 의학적 진단은 하지 마세요. 통증이 이어진다면 전문가와 상담하라고 짧게만 말하세요.`

export function workoutSchema(keys: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      exercises: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', enum: keys },
            weightKg: { anyOf: [{ type: 'number' }, { type: 'null' }] },
            reps: { type: 'integer' },
            reason: { type: 'string' },
          },
          required: ['key', 'weightKg', 'reps', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'exercises'],
    additionalProperties: false,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** 무게는 0.25kg 단위로, 0 이하는 맨몸(null)으로 본다. */
function cleanWeight(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  if (v <= 0) return null
  if (v > 1000) return undefined
  return Math.round(v * 4) / 4
}

/**
 * AI 답을 확인하고 앱에서 쓰는 모양으로 바꾼다. 모르는 key, 이상한 값, 같은 종목의 두 번째 답은 버린다.
 * 쓸 수 있는 답이 하나도 없으면 AiError.
 */
export function parseWorkoutAdvice(raw: unknown, items: WorkoutContextItem[]): AiWorkoutAdvice {
  if (!isObj(raw) || !Array.isArray(raw.exercises)) {
    throw new AiError('AI 답의 모양이 달라 읽지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  const byKey = new Map(items.map((it) => [it.key, it]))
  const seen = new Set<string>()
  const exercises: AiExerciseSuggestion[] = []
  for (const e of raw.exercises) {
    if (!isObj(e) || typeof e.key !== 'string') continue
    const item = byKey.get(e.key)
    if (!item || seen.has(e.key)) continue
    const weight = cleanWeight(e.weightKg)
    const reps = typeof e.reps === 'number' ? Math.round(e.reps) : NaN
    if (weight === undefined || !(reps >= 1 && reps <= 100)) continue
    // 무게로 하는 종목인데 무게 없이 답하면 횟수만 모든 세트에 들어가 버리므로 버린다(기준 무게가 있을 때).
    if (!item.bodyweight && weight === null && item.fromWeightKg !== null) continue
    seen.add(e.key)
    exercises.push({
      workoutExerciseId: item.workoutExerciseId,
      weightKg: item.bodyweight ? null : weight,
      reps,
      reason: text(e.reason, 200),
      fromWeightKg: item.fromWeightKg,
    })
  }
  if (exercises.length === 0) {
    throw new AiError('AI 답에서 쓸 수 있는 추천을 찾지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  return { summary: text(raw.summary, 400), exercises }
}

// 화면을 옮겨 다녀도 같은 요청을 두 번 보내지 않도록, 진행 중인 요청을 id별로 기억한다.
const inFlight = new Map<string, Promise<AiAdvice>>()

function once(id: string, make: () => Promise<AiAdvice>): Promise<AiAdvice> {
  const running = inFlight.get(id)
  if (running) return running
  const p = make().finally(() => inFlight.delete(id))
  inFlight.set(id, p)
  return p
}

/** 아직 답을 기다리는 요청(없으면 undefined). 화면에 다시 들어왔을 때 이어서 기다리는 데 쓴다. */
export function pendingAdviceRequest(id: string): Promise<AiAdvice> | undefined {
  return inFlight.get(id)
}

async function requireKey(): Promise<string> {
  const key = await getAiApiKey()
  if (!key) throw new AiError('설정에서 Anthropic API 키를 먼저 넣어 주세요.', 'auth')
  return key
}

/** 진행 중인 운동에 대한 AI 추천을 받아 저장한다. 같은 운동의 요청이 진행 중이면 그 요청을 같이 기다린다. */
export function requestWorkoutAdvice(workoutId: string, now: number = Date.now()): Promise<AiAdvice> {
  return once(workoutAdviceId(workoutId), () => fetchWorkoutAdvice(workoutId, now))
}

async function fetchWorkoutAdvice(workoutId: string, now: number): Promise<AiAdvice> {
  const apiKey = await requireKey()
  const model = await getAiModel()
  const ctx = await buildWorkoutContext(workoutId, now)
  if (ctx.items.length === 0) throw new AiError('종목을 먼저 추가해 주세요.', 'request')

  const res = await askClaudeJson({
    apiKey,
    model,
    system: WORKOUT_SYSTEM,
    prompt: ctx.prompt,
    schema: workoutSchema(ctx.items.map((it) => it.key)),
  })
  const data = parseWorkoutAdvice(res.value, ctx.items)
  const advice: AiAdvice = {
    id: workoutAdviceId(workoutId),
    kind: 'workout',
    workoutId,
    createdAt: Date.now(),
    model: res.servedModel,
    costUsd: res.costUsd,
    data,
  }
  // 기다리는 동안 운동을 지웠으면 저장하지 않는다(지운 운동에 매인 답이 남지 않게). 요금은 이미 들었으니 센다.
  await db.transaction('rw', db.workouts, db.aiAdvice, async () => {
    if (await db.workouts.get(workoutId)) await db.aiAdvice.put(advice)
  })
  await addAiUsage(res.costUsd)
  return advice
}

export async function getWorkoutAdvice(workoutId: string): Promise<AiWorkoutAdvice & { meta: AdviceMeta } | null> {
  const row = await db.aiAdvice.get(workoutAdviceId(workoutId))
  if (!row || row.kind !== 'workout') return null
  return { ...row.data, meta: { createdAt: row.createdAt, model: row.model, costUsd: row.costUsd } }
}

export interface AdviceMeta {
  createdAt: number
  model: string
  costUsd: number
}

// ───────── 기록 분석

export const REVIEW_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자의 최근 몇 주 운동 기록을 보고 짧은 분석을 씁니다. 사용자는 폰의 통계 화면에서 이 글을 읽습니다.

볼 것: 운동 빈도와 꾸준함, 부위별 세트 균형(특히 크게 모자라거나 몰린 부위), 종목별 성장과 정체, 루틴 구성, 메모에 적힌 컨디션.

쓰는 법:
- headline은 지금 상태를 한 문장으로 씁니다.
- good에는 잘하고 있는 점, watch에는 살펴볼 점, suggestions에는 다음 4주 동안 해 볼 구체적인 행동(종목, 세트 수, 무게나 횟수처럼 바로 따라 할 수 있게)을 각각 1~3개 씁니다.
- 기록에 근거가 있는 말만 하고, 숫자를 인용할 때는 기록에 있는 값을 그대로 씁니다.
- 모두 한국어 해요체로, 항목 하나는 한두 문장으로 짧게 씁니다.
- 의학적 진단은 하지 마세요.`

export const REVIEW_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    good: { type: 'array', items: { type: 'string' } },
    watch: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'good', 'watch', 'suggestions'],
  additionalProperties: false,
}

export function parseReview(raw: unknown): AiReview {
  if (!isObj(raw) || typeof raw.headline !== 'string') {
    throw new AiError('AI 답의 모양이 달라 읽지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  const list = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x) => text(x, 300))
      .filter((x) => x !== '')
      .slice(0, 4)
  return { headline: text(raw.headline, 300), good: list(raw.good), watch: list(raw.watch), suggestions: list(raw.suggestions) }
}

/** 최근 기록 분석을 받아 저장한다(가장 최근 것 하나만 남는다). 진행 중이면 그 요청을 같이 기다린다. */
export function requestReview(now: number = Date.now()): Promise<AiAdvice> {
  return once(REVIEW_ADVICE_ID, () => fetchReview(now))
}

async function fetchReview(now: number): Promise<AiAdvice> {
  const apiKey = await requireKey()
  const model = await getAiModel()
  const prompt = await buildReviewContext(now)
  if (prompt === null) throw new AiError('분석할 운동 기록이 아직 없습니다.', 'request')

  const res = await askClaudeJson({ apiKey, model, system: REVIEW_SYSTEM, prompt, schema: REVIEW_SCHEMA })
  const advice: AiAdvice = {
    id: REVIEW_ADVICE_ID,
    kind: 'review',
    workoutId: null,
    createdAt: Date.now(),
    model: res.servedModel,
    costUsd: res.costUsd,
    data: parseReview(res.value),
  }
  await db.aiAdvice.put(advice)
  await addAiUsage(res.costUsd)
  return advice
}

export async function getReview(): Promise<(AiReview & { meta: AdviceMeta }) | null> {
  const row = await db.aiAdvice.get(REVIEW_ADVICE_ID)
  if (!row || row.kind !== 'review') return null
  return { ...row.data, meta: { createdAt: row.createdAt, model: row.model, costUsd: row.costUsd } }
}
