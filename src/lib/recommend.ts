import { db, type Exercise, type SetEntry, type Workout, type WorkoutExercise } from '../db'
import { incrementFor } from './exercises'
import { getExerciseSessions, isWeighted, workingSets } from './history'
import { formatSeconds, formatWeight, isTimed, setSeconds, usesAddedWeight } from './measure'

/**
 * 다음 무게 추천(규칙 기반). (2단계)
 *
 * 가장 최근 기록의 완료한 본 세트를 보고 정한다.
 * - 무게를 단 종목: 가장 무거운 본 세트의 무게(W)로 한 세트들이 모두 목표 횟수(T)를 채웠으면 W + 증량 단위,
 *   못 채웠으면 W를 그대로. 같은 W에서 3번 연속 못 채웠으면 W의 약 90%로 낮춘다(증량 단위의 배수로 내림).
 * - 맨몸 종목: 지난번 가장 많이 한 횟수 + 1. 지난번에 추가 무게를 달았으면 그 추가 무게를 위의 규칙대로 올린다.
 * - 시간 종목: 지난번 가장 오래 버틴 시간 + 5초. 목표 시간을 못 채운 세트가 있었으면 목표 시간.
 *
 * 3단계에서 LLM 추천을 더하더라도 이 규칙으로 돌아올 수 있게, 계산은 DB를 보지 않는 순수 함수(recommendNext)로 둔다.
 */

/**
 * increase: 무게 올리기, keep: 같은 무게(시간 종목이면 목표 시간 다시), deload: 무게 낮추기,
 * addReps: 맨몸 종목 횟수 늘리기, addTime: 시간 종목 시간 늘리기
 */
export type RecommendationKind = 'increase' | 'keep' | 'deload' | 'addReps' | 'addTime'

export interface Recommendation {
  kind: RecommendationKind
  /** 추천 무게(kg). 무게 없이 하는 맨몸 종목과 시간 종목이면 null */
  weightKg: number | null
  /** 추천 횟수. 시간 추천이면 0 */
  reps: number
  /** 추천 시간(초). 시간 종목의 추천에만 있다. 무게는 건드리지 않고 시간만 채운다. */
  durationSec?: number
  /**
   * 판단에 쓴 지난번 최고 무게(kg). 맨몸 종목이면 null.
   * 적용할 때 이 무게로 채워진 세트만 바꿔서, 피라미드처럼 무게를 바꿔 가며 하는 가벼운 세트는 그대로 둔다.
   */
  fromWeightKg: number | null
  /** 화면에 보여 주는 짧은 이유 */
  reason: string
  /** 판단에 쓴 지난 운동의 id */
  basedOnWorkoutId: string
}

/** 추천에 쓰는 지난 기록 한 번. getExerciseSessions의 결과를 그대로 넣으면 된다. */
export interface RecommendSession {
  workout: Pick<Workout, 'id' | 'startedAt'>
  we: Pick<WorkoutExercise, 'targetReps'>
  sets: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone' | 'durationSec'>[]
}

/** 시간 종목에서 한 번에 늘리는 시간(초) */
export const TIME_STEP_SECONDS = 5

/** 같은 무게에서 이만큼 연속으로 목표를 못 채우면 무게를 낮춘다. */
export const STALL_SESSIONS = 3
/** 무게를 낮출 때의 비율(약 10% 낮춤) */
export const DELOAD_RATIO = 0.9

/** 같은 무게로 볼 차이(소수 계산 오차) */
const EPSILON = 1e-6

type SetLike = RecommendSession['sets'][number]

/** 무게를 0.01kg 단위로 맞춘다(62.5 + 2.5 같은 계산의 소수 오차를 없앤다). */
function roundKg(n: number): number {
  return Math.round(n * 100) / 100
}

/** 목표 횟수로 쓸 수 있는 값이면 그 값, 아니면 null */
function validReps(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.round(v) : null
}

/** 완료한 본 세트 중 횟수가 있는 것 */
function countedSets<T extends SetLike>(sets: T[]): T[] {
  return workingSets(sets).filter((s) => (s.reps ?? 0) > 0)
}

/** 완료한 본 세트의 버틴 시간(초)들, 순서대로 */
function heldSeconds(sets: SetLike[]): number[] {
  return workingSets(sets)
    .map(setSeconds)
    .filter((sec) => sec > 0)
}

/**
 * 시간 종목의 추천. 지난번 가장 오래 버틴 시간보다 5초 더.
 * 목표 시간이 있는데 못 채운 세트가 있었으면 올리지 않고 목표 시간을 다시 추천한다.
 */
function recommendTime(
  exercise: Pick<Exercise, 'targetReps'>,
  sessions: readonly RecommendSession[],
  todayTarget?: number | null,
): Recommendation | null {
  const last = sessions
    .filter((s) => heldSeconds(s.sets).length > 0)
    .sort((a, b) => a.workout.startedAt - b.workout.startedAt)
    .at(-1)
  if (!last) return null
  const held = heldSeconds(last.sets)
  const best = Math.max(...held)
  // 시간 종목의 targetReps는 목표 시간(초)이다(lib/measure.ts).
  const target = validReps(last.we.targetReps) ?? validReps(todayTarget) ?? validReps(exercise.targetReps)
  const base = { weightKg: null, reps: 0, fromWeightKg: null, basedOnWorkoutId: last.workout.id }
  if (target !== null && held.some((sec) => sec < target)) {
    return {
      ...base,
      kind: 'keep',
      durationSec: target,
      reason: `${formatSeconds(target)}를 못 채운 세트가 있어서 다시 해요`,
    }
  }
  return {
    ...base,
    kind: 'addTime',
    durationSec: Math.round(best) + TIME_STEP_SECONDS,
    reason: `지난번 최고 ${formatSeconds(best)}보다 ${TIME_STEP_SECONDS}초 더 버텨 봐요`,
  }
}

/** 가장 무거운 본 세트의 무게와, 그 무게로 한 세트들의 횟수(순서대로). 무게를 단 세트가 없으면 null */
function topSets(sets: SetLike[]): { weight: number; reps: number[] } | null {
  const weighted = countedSets(sets).filter(isWeighted)
  if (weighted.length === 0) return null
  const weight = Math.max(...weighted.map((s) => s.weightKg as number))
  const reps = weighted.filter((s) => Math.abs((s.weightKg as number) - weight) < EPSILON).map((s) => s.reps as number)
  return { weight, reps }
}

/** 약 10% 낮춘 무게. 증량 단위의 배수로 내리고, 증량 단위보다 낮게는 내리지 않는다. */
export function deloadWeight(weightKg: number, incrementKg: number): number {
  const steps = Math.floor((weightKg * DELOAD_RATIO) / incrementKg + EPSILON)
  return roundKg(Math.max(1, steps) * incrementKg)
}

/**
 * 다음에 할 무게와 횟수를 정한다. 지난 기록(완료한 본 세트가 있는 것)이 없으면 null.
 *
 * sessions: 이 종목의 지난 기록(순서는 상관없다. 지금 하는 운동은 빼고 넣는다).
 * todayTargetReps: 오늘의 목표 횟수(지금 운동의 WorkoutExercise.targetReps).
 *
 * 목표 횟수 T는 지난 기록의 목표 → 오늘의 목표 → 종목의 목표 순으로 정하고,
 * 모두 없으면 지난번 W로 한 첫 세트의 횟수를 쓴다(즉 "W로 한 세트들이 모두 같은 횟수를 채웠는지"를 본다).
 *
 * 맨몸 종목도 세트를 보고 정한다. 지난번에 추가 무게를 단 세트가 있으면 그 추가 무게를 무게 종목과 같은 규칙으로 올리고,
 * 없으면 횟수를 1회 늘린다.
 */
export function recommendNext(
  exercise: Pick<Exercise, 'bodyPart' | 'incrementKg' | 'targetReps' | 'measure'> & Partial<Pick<Exercise, 'equipment'>>,
  sessions: readonly RecommendSession[],
  todayTargetReps?: number | null,
): Recommendation | null {
  if (isTimed(exercise)) return recommendTime(exercise, sessions, todayTargetReps)
  const added = usesAddedWeight(exercise)
  const ordered = sessions
    .filter((s) => countedSets(s.sets).length > 0)
    .sort((a, b) => a.workout.startedAt - b.workout.startedAt)
  const last = ordered.at(-1)
  if (!last) return null
  const basedOnWorkoutId = last.workout.id

  const top = topSets(last.sets)
  if (!top) {
    // 맨몸 종목: 지난번 가장 많이 한 횟수보다 1회 더
    const best = Math.max(...countedSets(last.sets).map((s) => s.reps as number))
    return {
      kind: 'addReps',
      weightKg: null,
      reps: best + 1,
      fromWeightKg: null,
      reason: `지난번 최고 ${best}회보다 1회 더 해 봐요`,
      basedOnWorkoutId,
    }
  }

  const target =
    validReps(last.we.targetReps) ?? validReps(todayTargetReps) ?? validReps(exercise.targetReps) ?? top.reps[0]
  const weight = top.weight
  const reached = (t: { reps: number[] }) => t.reps.every((r) => r >= target)

  if (reached(top)) {
    const count = top.reps.length
    return {
      kind: 'increase',
      weightKg: roundKg(weight + incrementFor(exercise)),
      reps: target,
      fromWeightKg: weight,
      reason:
        count > 1
          ? `지난번 ${count}세트 모두 ${target}회를 채웠어요`
          : `지난번 ${formatWeight(weight, added)}로 ${target}회를 채웠어요`,
      basedOnWorkoutId,
    }
  }

  // 같은 무게에서 최근 3번 모두 목표를 못 채웠으면 무게를 낮춰 다시 쌓는다.
  const recent = ordered.slice(-STALL_SESSIONS)
  const stalled =
    recent.length === STALL_SESSIONS &&
    recent.every((s) => {
      const t = topSets(s.sets)
      return t !== null && Math.abs(t.weight - weight) < EPSILON && !reached(t)
    })
  if (stalled) {
    const lower = deloadWeight(weight, incrementFor(exercise))
    if (lower < weight - EPSILON) {
      return {
        kind: 'deload',
        weightKg: lower,
        reps: target,
        fromWeightKg: weight,
        reason: `${STALL_SESSIONS}번 연속 ${target}회를 못 채워서 무게를 조금 낮춰요`,
        basedOnWorkoutId,
      }
    }
  }

  return {
    kind: 'keep',
    weightKg: weight,
    reps: target,
    fromWeightKg: weight,
    reason: `${target}회를 못 채운 세트가 있어서 같은 무게로 다시 해요`,
    basedOnWorkoutId,
  }
}

/**
 * 운동 안의 한 종목에 대한 추천. 지금 운동은 빼고 끝난 기록만 본다.
 * 지난 기록이 없거나 종목이 지워졌으면 null.
 */
export async function getRecommendation(
  we: Pick<WorkoutExercise, 'workoutId' | 'exerciseId' | 'targetReps'>,
  exercise?: Exercise,
): Promise<Recommendation | null> {
  const ex = exercise ?? (await db.exercises.get(we.exerciseId))
  if (!ex) return null
  const sessions = await getExerciseSessions(we.exerciseId, { excludeWorkoutId: we.workoutId })
  return recommendNext(ex, sessions, we.targetReps)
}

/** 운동에 들어 있는 모든 종목의 추천. WorkoutExercise id → 추천(없으면 null). */
export async function getWorkoutRecommendations(workoutId: string): Promise<Map<string, Recommendation | null>> {
  const wes = await db.workoutExercises.where('workoutId').equals(workoutId).toArray()
  const exercises = await db.exercises.bulkGet(wes.map((we) => we.exerciseId))
  const result = new Map<string, Recommendation | null>()
  for (const [i, we] of wes.entries()) {
    const ex = exercises[i]
    result.set(we.id, ex ? await getRecommendation(we, ex) : null)
  }
  return result
}

/** 추천을 채울 세트: 아직 완료하지 않은 본 세트 */
function pendingWorkingSets<T extends Pick<SetEntry, 'isWarmup' | 'isDone'>>(sets: T[]): T[] {
  return sets.filter((s) => !s.isDone && !s.isWarmup)
}

type ApplyRec = Pick<Recommendation, 'weightKg' | 'reps'> & { fromWeightKg?: number | null; durationSec?: number | null }

export interface ApplyOptions {
  /**
   * 맨몸 종목(세트의 무게가 추가 무게)인지. 맨몸 종목은 무게가 빈 세트도 "맨몸으로 하는 세트"라서,
   * 무게 추천은 추가 무게를 단 세트에만, 횟수 추천은 맨몸 세트에만 채운다.
   */
  addedWeight?: boolean
}

type ApplySet = Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone' | 'durationSec'>

const sameKg = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < EPSILON

/** 시간 추천인지(채울 시간이 있는지) */
function timeOf(rec: ApplyRec): number | null {
  return typeof rec.durationSec === 'number' && rec.durationSec > 0 ? rec.durationSec : null
}

/** 추천 값을 화면에 쓰는 글자로. "62.5kg × 8", 무게가 없으면 "9회", 추가 무게면 "+12.5kg × 5", 시간 추천은 "65초" */
export function formatRecommendation(rec: ApplyRec, opts: ApplyOptions = {}): string {
  const seconds = timeOf(rec)
  if (seconds !== null) return formatSeconds(seconds)
  return rec.weightKg === null ? `${rec.reps}회` : `${formatWeight(rec.weightKg, opts.addedWeight)} × ${rec.reps}`
}

/**
 * 추천을 채울 세트. 아직 하지 않은 본 세트 중 지난번 최고 무게로 채워진 세트와 무게가 빈 세트만 고른다.
 * 피라미드(60, 62.5, 70)처럼 무게를 바꿔 가며 하면 가벼운 세트는 그대로 둔다.
 * 그런 세트가 없거나(값을 직접 바꾼 경우) 맨몸 추천이나 시간 추천이면 아직 하지 않은 본 세트 모두.
 *
 * 맨몸 종목(opts.addedWeight)은 추가 무게 세트와 맨몸 세트를 섞어 하기도 하므로 나눠서 고른다.
 * 무게 추천은 지난번 최고 추가 무게로 채워진 세트와 아무것도 적지 않은 세트에, 횟수 추천은 무게를 달지 않은 세트에 채운다.
 */
export function setsToApply<T extends Pick<SetEntry, 'weightKg' | 'isWarmup' | 'isDone'> & Partial<Pick<SetEntry, 'reps'>>>(
  sets: T[],
  rec: ApplyRec,
  opts: ApplyOptions = {},
): T[] {
  const pending = pendingWorkingSets(sets)
  if (timeOf(rec) !== null) return pending
  // 맨몸 종목의 횟수 추천은 무게를 달지 않은 세트에만 채운다. 추가 무게 세트에 횟수만 덮어쓰지 않는다.
  if (rec.weightKg === null) return opts.addedWeight ? pending.filter((s) => !isWeighted(s)) : pending
  const from = rec.fromWeightKg
  if (from === undefined || from === null) return pending
  // 맨몸 종목에서 무게 없이 횟수만 적힌 세트는 맨몸으로 하려는 세트라 그대로 둔다.
  const blank = (s: T) => s.weightKg === null && !(opts.addedWeight && (s.reps ?? 0) > 0)
  const picked = pending.filter((s) => blank(s) || sameKg(s.weightKg, from))
  if (picked.length > 0) return picked
  // 이미 적용해서 그 세트를 끝냈으면 더 채울 세트가 없다. 남은 가벼운 세트(백오프)를 건드리지 않는다.
  return appliedSetIsDone(sets, rec) ? [] : pending
}

/** 추천 무게로 끝낸 본 세트가 있는지(적용한 뒤 그 세트를 완료한 경우) */
function appliedSetIsDone(sets: Pick<SetEntry, 'weightKg' | 'isWarmup' | 'isDone'>[], rec: ApplyRec): boolean {
  return sets.some((s) => s.isDone && !s.isWarmup && sameKg(s.weightKg, rec.weightKg))
}

/** 추천을 이미 적용했는지. 아직 하지 않은 본 세트가 없으면 false. */
export function isRecommendationApplied(sets: ApplySet[], rec: ApplyRec, opts: ApplyOptions = {}): boolean {
  const pending = pendingWorkingSets(sets)
  if (pending.length === 0) return false
  const seconds = timeOf(rec)
  if (seconds !== null) return pending.every((s) => s.durationSec === seconds)
  if (rec.weightKg === null) return setsToApply(sets, rec, opts).every((s) => s.reps === rec.reps)
  const from = rec.fromWeightKg
  // 바꿀 무게를 모르는 추천이면 남은 본 세트가 모두 추천 값이어야 한다.
  if (from === undefined || from === null) {
    return pending.every((s) => s.reps === rec.reps && sameKg(s.weightKg, rec.weightKg))
  }
  const atRec = pending.filter((s) => sameKg(s.weightKg, rec.weightKg))
  // 적용한 세트를 이미 끝냈고 더 채울 세트가 없으면 적용된 것으로 본다(다시 눌러 다른 세트를 바꾸지 않게).
  if (atRec.length === 0 && setsToApply(sets, rec, opts).length === 0) return true
  if (atRec.length === 0 || atRec.some((s) => s.reps !== rec.reps)) return false
  // 무게가 빈 세트나, 아직 바꾸지 않은 지난번 최고 무게 세트가 남아 있으면 적용 전이다.
  // (맨몸 종목에서 횟수만 적힌 세트는 맨몸 세트라 빈 세트로 치지 않는다.)
  if (pending.some((s) => s.weightKg === null && !(opts.addedWeight && (s.reps ?? 0) > 0))) return false
  if (!sameKg(from, rec.weightKg) && pending.some((s) => sameKg(s.weightKg, from))) return false
  return true
}

/**
 * 추천 무게와 횟수를 채운다(어느 세트인지는 setsToApply). 완료한 세트와 웜업은 그대로 둔다.
 * 맨몸 종목 추천(무게 null)이면 횟수만, 시간 추천이면 시간만 바꾼다. 바꾼 세트 수를 돌려준다.
 */
export async function applyRecommendation(
  workoutExerciseId: string,
  rec: ApplyRec,
  opts: ApplyOptions = {},
): Promise<number> {
  return db.transaction('rw', db.sets, async () => {
    const sets = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray()
    const targets = setsToApply(sets, rec, opts)
    const seconds = timeOf(rec)
    const changes: Partial<Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>> =
      seconds !== null
        ? { durationSec: seconds }
        : rec.weightKg === null
          ? { reps: rec.reps }
          : { weightKg: rec.weightKg, reps: rec.reps }
    await db.sets.bulkUpdate(targets.map((s) => ({ key: s.id, changes })))
    return targets.length
  })
}
