import { db, type Equipment, type Exercise } from '../../db'
import { bodyPartLabel, equipmentLabel, incrementFor } from '../exercises'
import { formatKg, toDateKey } from '../format'
import { getExerciseSessions, summarizeSession, workingSets, type ExerciseSession } from '../history'
import { isTimed, setTextOptions, usesAddedWeight, usesAssist } from '../measure'
import { getAiProfile } from '../settings'
import { askAndCount, once, pendingAdviceRequest, requireKey } from './advice'
import { AiError } from './client'
import { ASSIST_NOTE, bodyWeightLine, describeDoneSets, describePlannedSets } from './context'
import { aiModelInfo, estimateCostUsd, formatUsd, getAiModel, type AiModelId } from './models'
import { profileLines } from './profile'

/**
 * AI 대체 종목 추천. 운동 중에 "기구가 차 있어요", "몸이 불편해요" 같은 까닭을 고르면,
 * 내 종목 목록에서 같은 부위의 다른 종목 2~3개와 시작 무게를 받아 눌러서 바꾼다.
 * 금방 쓰고 마는 답이라 폰에 저장하지 않고, 앱을 켜 둔 동안만 종목별로 기억한다.
 * 고르는 일이라 비싼 모델은 쓰지 않는다(Opus를 골라 두었으면 Sonnet으로 묻는다).
 */

/** 바꾸려는 까닭. label은 화면의 버튼, prompt는 AI에게 보내는 글 */
export const SWAP_REASONS = [
  { value: 'busy', label: '기구가 차 있어요', prompt: '지금 그 기구를 다른 사람이 쓰고 있어 기다리기 어려움' },
  { value: 'missing', label: '기구가 없어요', prompt: '이 헬스장에는 그 기구가 없음' },
  { value: 'pain', label: '몸이 불편해요', prompt: '이 동작을 하면 몸이 불편함(통증이나 불편감)' },
  { value: 'variety', label: '다른 자극을 원해요', prompt: '같은 부위를 다른 기구나 각도로 자극하고 싶음' },
] as const

export type SwapReason = (typeof SWAP_REASONS)[number]['value']

/** 까닭에 덧붙이는 글의 최대 길이 */
export const SWAP_DETAIL_MAX = 100
/** 받는 대체 종목 수 */
export const SWAP_OPTIONS_MAX = 3
/** 고를 수 있는 종목으로 보내는 최대 수(같은 부위만 보내므로 보통 이보다 적다) */
const CANDIDATES_MAX = 40
/** 바꾸려는 종목과 고를 수 있는 종목마다 보내는 지난 기록 수 */
const SOURCE_SESSIONS = 3
const CANDIDATE_WEEKS = 12
const DAY = 24 * 60 * 60 * 1000

/** 대체 종목 추천에 쓰는 모델. Opus는 Sonnet으로 낮추고, Sonnet이나 Haiku를 골라 두었으면 그대로 쓴다. */
export function swapModel(model: AiModelId): AiModelId {
  return model === 'claude-opus-5-5' ? 'claude-sonnet-5-5' : model
}

/** 요청 한 번에 드는 토큰 수의 어림값: 같은 부위 종목 10~20개와 그 최근 기록 */
const TYPICAL_SWAP_USAGE = { input_tokens: 2500, output_tokens: 1500 }

/** 요청 한 번의 어림 요금. "$0.02" */
export function swapCostText(model: AiModelId): string {
  const m = swapModel(model)
  return formatUsd(estimateCostUsd(TYPICAL_SWAP_USAGE, m, m))
}

/** 대체 종목 추천에 쓰는 모델의 이름. "Sonnet 5.5" */
export function swapModelLabel(model: AiModelId): string {
  const m = swapModel(model)
  return aiModelInfo(m)?.label ?? m
}

/** 이 종목에 대체 종목 추천을 쓸 수 있는지. 무게×횟수로 하는 종목만(시간 종목과 유산소는 뺀다). */
export function canSwap(exercise: Exercise | undefined): exercise is Exercise {
  return exercise !== undefined && !isTimed(exercise)
}

export interface SwapOption {
  exerciseId: string
  name: string
  equipment: Equipment
  /** 시작 무게(kg). 맨몸이거나 알 수 없으면 null */
  weightKg: number | null
  reps: number
  reason: string
  /** 맨몸 종목이라 무게가 추가 무게 */
  addedWeight: boolean
  /** 보조 머신이라 무게가 보조 무게 */
  assist: boolean
}

export interface SwapResult {
  /** 바꾸려는 종목의 WorkoutExercise id */
  workoutExerciseId: string
  options: SwapOption[]
  /** 전체에 대한 짧은 말(없으면 빈 글) */
  note: string
  model: string
  costUsd: number
  createdAt: number
}

export interface SwapCandidate {
  /** 답에서 종목을 가리키는 짧은 이름("E1", "E2" …) */
  key: string
  exercise: Exercise
}

export interface SwapContext {
  prompt: string
  candidates: SwapCandidate[]
}

export const SWAP_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자가 운동 중에 한 종목을 할 수 없거나 바꾸고 싶다고 하면, "고를 수 있는 종목"에서 대신할 종목을 2~3개 고르고 각각의 시작 무게와 횟수를 정합니다. 사용자는 헬스장에서 폰으로 이 답을 보고 하나를 눌러 바로 바꿉니다.

어떻게 고를지:
- 바꾸려는 종목과 같은 근육을 비슷한 움직임으로 쓰는 종목을 먼저 고르세요. 바꾸는 까닭에 맞게 고릅니다. 기구가 차 있거나 없으면 다른 기구로 하는 종목을, 몸이 불편하면 그 부위에 부담이 덜한 종목(가동 범위가 짧거나, 머신·케이블처럼 궤적이 정해져 있거나, 더 가벼운 무게로 하는 종목)을 고르세요.
- "내 정보"의 참고할 점에 적힌 부상이나 피하고 싶은 동작에 걸리는 종목은 고르지 마세요. 사용자가 덧붙인 말도 꼭 반영하세요.
- 오늘 이미 하는 종목은 목록에 없습니다. 오늘 할 다른 종목과 겹치지 않게 고르세요.
- 고를 만한 종목이 하나뿐이면 하나만 답해도 됩니다. 알맞은 종목이 없으면 alternatives를 빈 배열로 두고 note에 까닭을 적으세요.

시작 무게와 횟수:
- 그 종목의 지난 기록이 있으면 최근 본 세트를 기준으로 정하세요. 몸이 불편해서 바꾸는 경우는 한 단계 가볍게 정하세요.
- 지난 기록이 없으면 바꾸려는 종목의 기록(추정 1RM 등)과 체중, 운동 경력에서 보수적으로 어림하세요. 덤벨 무게는 한 손의 무게입니다. 어림하기 어려우면 weightKg를 null로 두고 reason에 가볍게 시작하라고 적으세요.
- 무게는 2.5kg 단위(덤벨은 2kg 단위도 괜찮음)로, 횟수는 바꾸려는 종목의 목표 횟수에 맞추세요.
- 맨몸 종목은 weightKg를 null로 둡니다. 다만 기록에 추가 무게가 있는 맨몸 종목은 추가 무게(kg)를 넣어도 됩니다.
- 보조 머신의 무게는 몸무게를 덜어 주는 보조 무게라 높을수록 쉽습니다.

어떻게 쓸지:
- key는 받은 종목의 key(E1, E2 …)를 그대로 씁니다. 같은 종목을 두 번 넣지 않습니다. 잘 맞는 것부터 씁니다.
- reason은 이 종목을 고른 까닭과 시작 무게의 근거를 한국어 해요체 한 문장(50자 안팎)으로 씁니다.
- note는 전체에 대한 한마디를 한국어 해요체 한 문장으로 씁니다. 할 말이 없으면 빈 글로 둡니다.
- 의학적 진단은 하지 마세요. 통증이 이어진다면 전문가와 상담하라고 짧게만 말하세요.`

export function swapSchema(keys: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      alternatives: {
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
      note: { type: 'string' },
    },
    required: ['alternatives', 'note'],
    additionalProperties: false,
  }
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const dateLabel = (ts: number) => `${toDateKey(ts)}(${WEEKDAYS[new Date(ts).getDay()]})`
const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max).trim() : '')
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 기록 한 번. "2026-11-20(목): 60kg×8, 60kg×8 · 추정 1RM 76kg" */
function sessionText(s: ExerciseSession, exercise: Exercise): string {
  const opts = setTextOptions(exercise)
  const e1rm = opts.addedWeight || opts.assist ? null : summarizeSession(s.sets).bestE1rm
  return `${dateLabel(s.workout.startedAt)}: ${describeDoneSets(s.sets, opts)}${
    e1rm === null ? '' : ` · 추정 1RM ${formatKg(Math.round(e1rm * 10) / 10)}kg`
  }`
}

function kindText(exercise: Exercise): string {
  const parts = [`${bodyPartLabel(exercise.bodyPart)}, ${equipmentLabel(exercise.equipment)}`]
  if (usesAssist(exercise)) parts.push(ASSIST_NOTE)
  else if (usesAddedWeight(exercise)) parts.push('맨몸 종목')
  return parts.join(' · ')
}

function noteOf(exercise: Exercise): string {
  return oneLine(exercise.note ?? '', 200)
}

/**
 * 대체 종목 요청 글. 바꾸려는 종목과 오늘 세트, 지난 기록, 바꾸는 까닭, 내 정보(부상 메모, 체중),
 * 오늘 하는 다른 종목, 같은 부위에서 고를 수 있는 종목(최근 기록 포함)을 담는다.
 * 숨긴 종목, 오늘 이미 하는 종목, 시간 종목과 유산소 종목은 고를 수 있는 종목에서 뺀다.
 */
export async function buildSwapContext(
  workoutExerciseId: string,
  reason: SwapReason,
  detail: string,
  now: number = Date.now(),
): Promise<SwapContext> {
  const we = await db.workoutExercises.get(workoutExerciseId)
  const workout = we ? await db.workouts.get(we.workoutId) : undefined
  const exercise = we ? await db.exercises.get(we.exerciseId) : undefined
  if (!we || !workout || !canSwap(exercise)) return { prompt: '', candidates: [] }

  const wes = await db.workoutExercises.where('workoutId').equals(we.workoutId).sortBy('order')
  const inWorkout = new Set(wes.map((x) => x.exerciseId))
  const all = await db.exercises.toArray()
  const byId = new Map(all.map((e) => [e.id, e]))
  const sets = await db.sets.where('workoutExerciseId').equals(we.id).sortBy('order')
  const target = we.targetReps ?? exercise.targetReps ?? null
  const history = (await getExerciseSessions(exercise.id, { excludeWorkoutId: workout.id, before: workout.startedAt })).slice(
    -SOURCE_SESSIONS,
  )

  const lines: string[] = [`오늘: ${dateLabel(now)}`, '']
  const head = [kindText(exercise), target === null ? '목표 횟수 정하지 않음' : `목표 ${target}회`]
  head.push(`증량 단위 ${formatKg(incrementFor(exercise))}kg`)
  lines.push(`바꾸려는 종목: ${exercise.name} (${head.join(' · ')})`)
  const note = noteOf(exercise)
  if (note !== '') lines.push(`  종목 메모: ${note}`)
  lines.push(`  오늘 세트: ${describePlannedSets(sets, setTextOptions(exercise))}`)
  if (history.length === 0) lines.push('  지난 기록: 없음')
  else lines.push('  지난 기록(오래된 것부터):', ...history.map((s) => `  - ${sessionText(s, exercise)}`))

  const why = SWAP_REASONS.find((r) => r.value === reason)?.prompt ?? ''
  lines.push('', `바꾸는 까닭: ${why}`)
  const extra = oneLine(detail, SWAP_DETAIL_MAX)
  if (extra !== '') lines.push(`사용자가 덧붙인 말: ${extra}`)

  const me = profileLines(await getAiProfile())
  const weight = await bodyWeightLine(now)
  if (weight) me.push(`- ${weight}`)
  if (me.length > 0) lines.push('', '내 정보:', ...me)

  const others = wes.filter((x) => x.id !== we.id).map((x) => byId.get(x.exerciseId)?.name ?? '지워진 종목')
  if (others.length > 0) lines.push('', `오늘 할 다른 종목: ${others.join(', ')}`)

  const from = now - CANDIDATE_WEEKS * 7 * DAY
  const pool = all
    .filter((e) => e.archived !== true && !inWorkout.has(e.id) && e.bodyPart === exercise.bodyPart && canSwap(e))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  // 최근에 한 종목을 먼저 보내고, 많으면 자른다.
  const withHistory = await Promise.all(
    pool.map(async (e) => {
      const sessions = (await getExerciseSessions(e.id, { excludeWorkoutId: workout.id, before: workout.startedAt })).filter(
        (s) => s.workout.startedAt >= from,
      )
      return { exercise: e, sessions }
    }),
  )
  const picked = withHistory
    .sort((a, b) => (b.sessions.at(-1)?.workout.startedAt ?? 0) - (a.sessions.at(-1)?.workout.startedAt ?? 0))
    .slice(0, CANDIDATES_MAX)

  lines.push('', `고를 수 있는 종목(같은 부위, 최근 ${CANDIDATE_WEEKS}주에 한 종목은 한 횟수와 마지막 기록을 붙임):`)
  const candidates: SwapCandidate[] = []
  for (const [i, { exercise: e, sessions }] of picked.entries()) {
    const key = `E${i + 1}`
    const parts = [`${key} ${e.name} (${kindText(e)})`]
    const last = sessions.at(-1)
    if (last && workingSets(last.sets).length > 0) {
      parts.push(`최근 ${sessions.length}회, 마지막 ${sessionText(last, e)}`)
    } else {
      parts.push('기록 없음')
    }
    const n = noteOf(e)
    if (n !== '') parts.push(`메모: ${n}`)
    lines.push(parts.join(' · '))
    candidates.push({ key, exercise: e })
  }
  return { prompt: lines.join('\n'), candidates }
}

/** 무게는 0.25kg 단위로, 0 이하는 맨몸(null)으로 본다. 말이 안 되는 값이면 undefined */
function cleanWeight(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  if (v <= 0) return null
  if (v > 1000) return undefined
  return Math.round(v * 4) / 4
}

/**
 * AI 답을 확인하고 화면에서 쓰는 모양으로 바꾼다. 모르는 key, 같은 종목의 두 번째 답, 이상한 값은 버리고 3개까지만 둔다.
 * 답이 비어 있으면(알맞은 종목이 없다고 하면) note를 담아 AiError.
 */
export function parseSwap(raw: unknown, candidates: SwapCandidate[]): { options: SwapOption[]; note: string } {
  if (!isObj(raw) || !Array.isArray(raw.alternatives)) {
    throw new AiError('AI 답의 모양이 달라 읽지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  const note = oneLine(raw.note, 300)
  const byKey = new Map(candidates.map((c) => [c.key, c.exercise]))
  const seen = new Set<string>()
  const options: SwapOption[] = []
  for (const a of raw.alternatives) {
    if (options.length >= SWAP_OPTIONS_MAX) break
    if (!isObj(a) || typeof a.key !== 'string') continue
    const ex = byKey.get(a.key)
    if (!ex || seen.has(ex.id)) continue
    const weight = cleanWeight(a.weightKg)
    const reps = typeof a.reps === 'number' ? Math.round(a.reps) : NaN
    if (weight === undefined || !(reps >= 1 && reps <= 100)) continue
    seen.add(ex.id)
    options.push({
      exerciseId: ex.id,
      name: ex.name,
      equipment: ex.equipment,
      weightKg: weight,
      reps,
      reason: oneLine(a.reason, 200),
      addedWeight: usesAddedWeight(ex),
      assist: usesAssist(ex),
    })
  }
  if (options.length === 0) {
    throw new AiError(note || 'AI가 알맞은 대체 종목을 찾지 못했습니다. 다른 까닭을 골라 다시 시도해 주세요.', 'invalid')
  }
  return { options, note }
}

/** 진행 중인 요청의 id(종목별) */
export const swapRequestId = (workoutExerciseId: string) => `swap:${workoutExerciseId}`

// 받은 답은 앱을 켜 둔 동안만 종목별로 기억한다(창을 닫았다 열어도 다시 요청하지 않게).
const results = new Map<string, SwapResult>()

export function cachedSwap(workoutExerciseId: string): SwapResult | null {
  return results.get(workoutExerciseId) ?? null
}

export function clearSwap(workoutExerciseId: string): void {
  results.delete(workoutExerciseId)
}

/** 아직 답을 기다리는 요청(없으면 undefined) */
export function pendingSwap(workoutExerciseId: string): Promise<SwapResult> | undefined {
  return pendingAdviceRequest(swapRequestId(workoutExerciseId)) as Promise<SwapResult> | undefined
}

/** 대체 종목을 받는다. 같은 종목의 요청이 진행 중이면 그 요청을 같이 기다린다. */
export function requestSwap(
  workoutExerciseId: string,
  reason: SwapReason,
  detail: string,
  now: number = Date.now(),
): Promise<SwapResult> {
  return once(swapRequestId(workoutExerciseId), () => fetchSwap(workoutExerciseId, reason, detail, now))
}

async function fetchSwap(workoutExerciseId: string, reason: SwapReason, detail: string, now: number): Promise<SwapResult> {
  const apiKey = await requireKey()
  const model = swapModel(await getAiModel())
  const ctx = await buildSwapContext(workoutExerciseId, reason, detail, now)
  if (ctx.prompt === '') throw new AiError('이 종목은 대체 종목을 추천받을 수 없습니다.', 'request')
  if (ctx.candidates.length === 0) {
    throw new AiError('같은 부위에 고를 수 있는 다른 종목이 없습니다. 종목을 먼저 추가해 주세요.', 'request')
  }
  const res = await askAndCount({
    apiKey,
    model,
    system: SWAP_SYSTEM,
    prompt: ctx.prompt,
    schema: swapSchema(ctx.candidates.map((c) => c.key)),
  })
  const { options, note } = parseSwap(res.value, ctx.candidates)
  const result: SwapResult = {
    workoutExerciseId,
    options,
    note,
    model: res.servedModel,
    costUsd: res.costUsd,
    createdAt: Date.now(),
  }
  results.set(workoutExerciseId, result)
  return result
}
