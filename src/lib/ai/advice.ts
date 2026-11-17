import {
  db,
  type AiAdvice,
  type AiExerciseSuggestion,
  type AiReview,
  type AiWorkoutAdvice,
  type AiWorkoutFeedback,
} from '../../db'
import { getAiApiKey } from '../settings'
import { AiError, askClaudeJson } from './client'
import {
  ADDED_WEIGHT_NOTE,
  buildFeedbackContext,
  buildReviewContext,
  buildWorkoutContext,
  NO_ADVICE_KEY,
  type WorkoutContextItem,
} from './context'
import { addAiUsage, getAiModel } from './models'

/** 오늘 운동 추천을 저장하는 id */
export const workoutAdviceId = (workoutId: string) => `workout:${workoutId}`
export const REVIEW_ADVICE_ID = 'review'
/** 끝난 운동의 피드백을 저장하는 id */
export const feedbackAdviceId = (workoutId: string) => `feedback:${workoutId}`

/** 모든 요청의 지시문에 함께 붙는, 내 정보와 기록 읽는 법 */
const SHARED_GUIDE = `기록 읽는 법:
- "내 정보"는 사용자가 설정에 적어 둔 목표, 운동 경력, 주당 운동 목표, 참고할 점과 최근 체중입니다. 있으면 답에 반영하고, 참고할 점에 적힌 부상이나 피하고 싶은 동작은 꼭 지키세요.
- 세트 뒤의 (RPE n)은 사용자가 적은 힘든 정도입니다(10이 더 못 하는 한계, 8이면 2회쯤 더 할 수 있었음). 적지 않은 세트가 많으니 있을 때만 참고하세요.
- "종목 메모"는 사용자가 그 종목에 적어 둔 세팅(시트 높이, 그립 등)입니다.
- 맨몸 종목의 "+10kg×8"은 몸에 10kg을 더 달고 8회 했다는 뜻이고, 무게 없이 "10회"라고만 적힌 세트는 맨몸으로 한 세트입니다. 체중은 볼륨에 들어 있지 않습니다.
- "45초"처럼 초로 적힌 세트는 시간으로 재는 종목(플랭크 등)에서 버틴 시간입니다. 이런 종목에는 횟수, 볼륨, 추정 1RM이 없습니다.`

// ───────── 운동 추천

export const WORKOUT_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자가 오늘 할 종목과 최근 기록을 보고, 종목마다 아직 하지 않은 본 세트에 쓸 무게와 횟수를 하나씩 제안합니다. 사용자는 운동 중에 폰으로 이 답을 보고, 마음에 들면 눌러서 세트에 채웁니다.

어떻게 정할지:
- 앱의 규칙 추천(목표 횟수를 모든 본 세트에서 채우면 증량 단위만큼 올리고, 못 채우면 같은 무게)을 출발점으로 삼으세요. 기록의 흐름(정체, 빠른 성장, 오래 쉰 기간, 메모에 적힌 컨디션, 오늘 이미 끝낸 세트)을 보고 더 나은 값이 있으면 바꿔도 됩니다.
- 무게는 한 번에 크게 올리지 말고, 그 종목의 증량 단위의 배수로 맞추세요.
- 오랜만에 하는 운동이거나 메모에 통증이나 피로가 있으면 보수적으로 정하세요.
- 맨몸 종목은 weightKg를 null로 두고 횟수만 정하세요. 다만 머리말에 "${ADDED_WEIGHT_NOTE}"이 붙은 맨몸 종목은 추가 무게를 달고 하는 종목이니, 무게 종목처럼 weightKg에 추가 무게(kg)를 넣어 제안하세요. 추가 무게 없이 맨몸으로 하라고 제안할 때만 null로 둡니다.
- 지난 기록이 없는 종목은 오늘 세트에 적힌 값을 따르세요. 무게가 비어 있으면 weightKg를 null로 두고, 가벼운 무게로 자세를 익히라고 이유에 적으세요.
- 오늘 본 세트를 이미 모두 끝낸 종목도 넣고, 이유에는 다음 운동 때의 기준을 적으세요.
- RPE가 낮았던(여유가 있던) 종목은 올리는 쪽으로, 목표 횟수를 채웠어도 RPE가 10에 가까웠으면 같은 무게를 한 번 더 하는 쪽으로 기울이세요.

${SHARED_GUIDE}

어떻게 쓸지:
- exercises에는 오늘 할 종목을 받은 key(E1, E2 …) 그대로 하나씩 모두 넣습니다. [${NO_ADVICE_KEY}]으로 표시한 종목은 시간으로 재는 종목이라 넣지 않습니다.
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
      // 맨몸 종목은 추가 무게를 쓰는 경우(오늘 세트나 지난 기록에 무게가 있을 때)에만 무게를 받는다.
      weightKg: item.bodyweight && !item.addedWeight ? null : weight,
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

/**
 * Claude에게 묻고, 요금이 든 요청은 모두 사용량에 더한다.
 * 답을 쓰지 못한 경우(잘림, 거절, 읽지 못함)도 요금은 들었으므로 오류에 실려 온 값을 더한다.
 */
export async function askAndCount(req: Parameters<typeof askClaudeJson>[0]): Promise<Awaited<ReturnType<typeof askClaudeJson>>> {
  try {
    const res = await askClaudeJson(req)
    await addAiUsage(res.costUsd)
    return res
  } catch (e) {
    if (e instanceof AiError && e.costUsd !== undefined) await addAiUsage(e.costUsd)
    throw e
  }
}

// 화면을 옮겨 다녀도 같은 요청을 두 번 보내지 않도록, 진행 중인 요청을 id별로 기억한다.
const inFlight = new Map<string, Promise<unknown>>()

/** 같은 id의 요청이 진행 중이면 그 요청을 돌려주고, 없으면 새로 시작한다. */
export function once<T>(id: string, make: () => Promise<T>): Promise<T> {
  const running = inFlight.get(id)
  if (running) return running as Promise<T>
  const p = make().finally(() => inFlight.delete(id))
  inFlight.set(id, p)
  return p
}

/** 아직 답을 기다리는 요청(없으면 undefined). 화면에 다시 들어왔을 때 이어서 기다리는 데 쓴다. */
export function pendingAdviceRequest(id: string): Promise<unknown> | undefined {
  return inFlight.get(id)
}

export async function requireKey(): Promise<string> {
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
  if (ctx.items.length === 0) throw new AiError('추천받을 종목을 먼저 추가해 주세요.', 'request')

  const res = await askAndCount({
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

볼 것: 운동 빈도와 꾸준함(주당 운동 목표가 있으면 그에 견주어), 부위별 세트 균형(특히 크게 모자라거나 몰린 부위), 종목별 성장과 정체, 루틴 구성, 메모에 적힌 컨디션, 목표에 비춘 체중 변화.

${SHARED_GUIDE}

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

  const res = await askAndCount({ apiKey, model, system: REVIEW_SYSTEM, prompt, schema: REVIEW_SCHEMA })
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
  return advice
}

export async function getReview(): Promise<(AiReview & { meta: AdviceMeta }) | null> {
  const row = await db.aiAdvice.get(REVIEW_ADVICE_ID)
  if (!row || row.kind !== 'review') return null
  return { ...row.data, meta: { createdAt: row.createdAt, model: row.model, costUsd: row.costUsd } }
}

// ───────── 운동 뒤 피드백

export const FEEDBACK_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자가 끝낸 운동 한 번의 기록을 같은 종목의 지난 기록과 비교해 짧은 피드백을 씁니다. 사용자는 폰의 기록 화면에서 이 글을 읽습니다.

볼 것: 같은 종목의 지난 기록과 견준 무게, 횟수, 볼륨, 추정 1RM의 변화, 목표 횟수를 채웠는지, 세트가 뒤로 갈수록 횟수가 얼마나 떨어졌는지, 이번에 세운 새 기록, 운동 사이의 간격, 메모에 적힌 컨디션.

${SHARED_GUIDE}

쓰는 법:
- headline은 이 운동을 한 문장으로 정리합니다.
- points에는 2~4개를 씁니다. 잘한 점과 다음 운동에서 해 볼 것을 섞고, 다음에 해 볼 것은 종목과 무게나 횟수를 들어 바로 따라 할 수 있게 씁니다.
- 기록에 근거가 있는 말만 하고, 숫자를 인용할 때는 기록에 있는 값을 그대로 씁니다. 지난 기록이 없는 종목은 비교하지 말고 기준이 생겼다고만 말합니다.
- 모두 한국어 해요체로, 항목 하나는 한두 문장으로 짧게 씁니다.
- 의학적 진단은 하지 마세요. 통증이 이어진다면 전문가와 상담하라고 짧게만 말하세요.`

export const FEEDBACK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'points'],
  additionalProperties: false,
}

/** 피드백 답을 확인한다. 빈 항목은 빼고 4개까지만 둔다. 총평이나 항목이 없으면 AiError. */
export function parseFeedback(raw: unknown): AiWorkoutFeedback {
  if (!isObj(raw) || typeof raw.headline !== 'string' || !Array.isArray(raw.points)) {
    throw new AiError('AI 답의 모양이 달라 읽지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  const headline = text(raw.headline, 300)
  const points = raw.points
    .map((x) => text(x, 300))
    .filter((x) => x !== '')
    .slice(0, 4)
  if (headline === '' || points.length === 0) {
    throw new AiError('AI 답에서 쓸 수 있는 피드백을 찾지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  return { headline, points }
}

/** 끝난 운동의 AI 피드백을 받아 저장한다. 같은 운동의 요청이 진행 중이면 그 요청을 같이 기다린다. */
export function requestWorkoutFeedback(workoutId: string, now: number = Date.now()): Promise<AiAdvice> {
  return once(feedbackAdviceId(workoutId), () => fetchWorkoutFeedback(workoutId, now))
}

async function fetchWorkoutFeedback(workoutId: string, now: number): Promise<AiAdvice> {
  const apiKey = await requireKey()
  const model = await getAiModel()
  const prompt = await buildFeedbackContext(workoutId, now)
  if (prompt === null) throw new AiError('끝낸 운동의 기록이 있어야 피드백을 받을 수 있습니다.', 'request')

  const res = await askAndCount({ apiKey, model, system: FEEDBACK_SYSTEM, prompt, schema: FEEDBACK_SCHEMA })
  // 답을 읽지 못하거나 그사이 운동을 지워도 요금은 이미 들었으니 센다.
  const advice: AiAdvice = {
    id: feedbackAdviceId(workoutId),
    kind: 'feedback',
    workoutId,
    createdAt: Date.now(),
    model: res.servedModel,
    costUsd: res.costUsd,
    data: parseFeedback(res.value),
  }
  // 기다리는 동안 운동을 지웠으면 저장하지 않는다(지운 운동에 매인 답이 남지 않게).
  await db.transaction('rw', db.workouts, db.aiAdvice, async () => {
    if (await db.workouts.get(workoutId)) await db.aiAdvice.put(advice)
  })
  return advice
}

export async function getWorkoutFeedback(workoutId: string): Promise<(AiWorkoutFeedback & { meta: AdviceMeta }) | null> {
  const row = await db.aiAdvice.get(feedbackAdviceId(workoutId))
  if (!row || row.kind !== 'feedback') return null
  return { ...row.data, meta: { createdAt: row.createdAt, model: row.model, costUsd: row.costUsd } }
}
