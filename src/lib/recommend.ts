import { db, type Exercise, type SetEntry, type Workout, type WorkoutExercise } from '../db'
import { incrementFor } from './exercises'
import { formatKg } from './format'
import { getExerciseSessions, isWeighted, workingSets } from './history'

/**
 * 다음 무게 추천(규칙 기반). (2단계)
 *
 * 가장 최근 기록의 완료한 본 세트를 보고 정한다.
 * - 무게를 단 종목: 가장 무거운 본 세트의 무게(W)로 한 세트들이 모두 목표 횟수(T)를 채웠으면 W + 증량 단위,
 *   못 채웠으면 W를 그대로. 같은 W에서 3번 연속 못 채웠으면 W의 약 90%로 낮춘다(증량 단위의 배수로 내림).
 * - 맨몸 종목: 지난번 가장 많이 한 횟수 + 1.
 *
 * 3단계에서 LLM 추천을 더하더라도 이 규칙으로 돌아올 수 있게, 계산은 DB를 보지 않는 순수 함수(recommendNext)로 둔다.
 */

/** increase: 무게 올리기, keep: 같은 무게, deload: 무게 낮추기, addReps: 맨몸 종목 횟수 늘리기 */
export type RecommendationKind = 'increase' | 'keep' | 'deload' | 'addReps'

export interface Recommendation {
  kind: RecommendationKind
  /** 추천 무게(kg). 맨몸 종목이면 null */
  weightKg: number | null
  /** 추천 횟수 */
  reps: number
  /** 화면에 보여 주는 짧은 이유 */
  reason: string
  /** 판단에 쓴 지난 운동의 id */
  basedOnWorkoutId: string
}

/** 추천에 쓰는 지난 기록 한 번. getExerciseSessions의 결과를 그대로 넣으면 된다. */
export interface RecommendSession {
  workout: Pick<Workout, 'id' | 'startedAt'>
  we: Pick<WorkoutExercise, 'targetReps'>
  sets: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone'>[]
}

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
 */
export function recommendNext(
  exercise: Pick<Exercise, 'bodyPart' | 'incrementKg' | 'targetReps'>,
  sessions: readonly RecommendSession[],
  todayTargetReps?: number | null,
): Recommendation | null {
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
      reason:
        count > 1 ? `지난번 ${count}세트 모두 ${target}회를 채웠어요` : `지난번 ${formatKg(weight)}kg로 ${target}회를 채웠어요`,
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
        reason: `${STALL_SESSIONS}번 연속 ${target}회를 못 채워서 무게를 조금 낮춰요`,
        basedOnWorkoutId,
      }
    }
  }

  return {
    kind: 'keep',
    weightKg: weight,
    reps: target,
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

/** 아직 완료하지 않은 본 세트가 모두 추천 값과 같은지. 그런 세트가 없으면 false. */
export function isRecommendationApplied(
  sets: Pick<SetEntry, 'weightKg' | 'reps' | 'isWarmup' | 'isDone'>[],
  rec: Pick<Recommendation, 'weightKg' | 'reps'>,
): boolean {
  const pending = pendingWorkingSets(sets)
  return (
    pending.length > 0 &&
    pending.every(
      (s) => s.reps === rec.reps && (rec.weightKg === null || Math.abs((s.weightKg ?? 0) - rec.weightKg) < EPSILON),
    )
  )
}

/**
 * 추천 무게와 횟수를 아직 완료하지 않은 본 세트에 채운다. 완료한 세트와 웜업은 그대로 둔다.
 * 맨몸 종목 추천(무게 null)이면 횟수만 바꾼다. 바꾼 세트 수를 돌려준다.
 */
export async function applyRecommendation(
  workoutExerciseId: string,
  rec: Pick<Recommendation, 'weightKg' | 'reps'>,
): Promise<number> {
  return db.transaction('rw', db.sets, async () => {
    const sets = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).toArray()
    const targets = pendingWorkingSets(sets)
    const changes: Partial<Pick<SetEntry, 'weightKg' | 'reps'>> =
      rec.weightKg === null ? { reps: rec.reps } : { weightKg: rec.weightKg, reps: rec.reps }
    await db.sets.bulkUpdate(targets.map((s) => ({ key: s.id, changes })))
    return targets.length
  })
}
