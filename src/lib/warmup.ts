import { db, type Exercise, type SetEntry } from '../db'
import { newId } from './id'
import { nearestLoadable, type PlateSetup } from './plates'

/**
 * 웜업 세트 만들기. (5단계)
 *
 * 본 세트의 무게(무게를 적은 첫 본 세트)를 보고 약 40% × 8회, 60% × 5회, 80% × 3회를 만든다.
 * 무게는 실제로 맞출 수 있는 값으로 고른다. 바벨은 바에 가진 원판을 양쪽에 끼운 무게, 그 밖의 기구는 2.5kg(20kg 아래는 1kg) 단위다.
 * 바벨의 웜업은 2.5kg 이상인 원판만 써서(보통 5kg 단위) 작은 원판을 여러 장 끼우지 않게 한다.
 * 계획(planWarmup, buildWarmupPlan)은 DB를 보지 않는 순수 함수이고, 세트에 넣는 일만 applyWarmup이 한다.
 */

export interface WarmupStep {
  weightKg: number
  reps: number
}

/** 본 세트 무게에 대한 비율과 횟수 */
export const WARMUP_STEPS: readonly { ratio: number; reps: number }[] = [
  { ratio: 0.4, reps: 8 },
  { ratio: 0.6, reps: 5 },
  { ratio: 0.8, reps: 3 },
]
/** 원판 없이 바만 드는 첫 웜업 세트의 횟수 */
export const EMPTY_BAR_REPS = 10

/** 바벨의 웜업 무게를 맞출 때 쓰는 가장 작은 원판(kg). 이보다 작은 원판만 켜져 있으면 그 원판을 쓴다. */
export const WARMUP_MIN_PLATE_KG = 2.5

/** 바벨이 아닌 기구에서 이 무게(kg)보다 가벼우면 1kg 단위, 아니면 2.5kg 단위로 맞춘다. */
const FINE_STEP_BELOW_KG = 20

/** 같은 무게로 볼 차이(소수 계산 오차) */
const EPSILON = 1e-6

function roundKg(n: number): number {
  return Math.round(n * 100) / 100
}

/** 바벨이 아닌 기구의 무게를 가장 가까운 2.5kg(20kg 아래는 1kg) 단위로 맞춘다. */
export function roundToStep(kg: number): number {
  const value = roundKg(kg)
  const step = value < FINE_STEP_BELOW_KG ? 1 : 2.5
  return roundKg(Math.round(value / step) * step)
}

/** 웜업 세트를 만들 수 있는 종목인지: 무게를 들고 횟수로 재는 종목(맨몸, 시간, 유산소 종목은 아니다). */
export function canWarmup(exercise: Pick<Exercise, 'equipment' | 'measure'> | null | undefined): boolean {
  if (!exercise) return false
  return exercise.equipment !== 'bodyweight' && exercise.measure !== 'time' && exercise.measure !== 'cardio'
}

/** 웜업의 기준이 되는 무게: 무게를 적은 첫 본 세트의 무게. 없으면 null */
export function workingWeight(sets: readonly Pick<SetEntry, 'weightKg' | 'isWarmup'>[]): number | null {
  return sets.find((s) => !s.isWarmup && (s.weightKg ?? 0) > 0)?.weightKg ?? null
}

/** 웜업 무게를 맞출 때 쓰는 원판: 가진 원판 중 2.5kg 이상인 것. 하나도 없으면 가진 원판 모두. */
function warmupSetup(bar: PlateSetup): PlateSetup {
  const plates = bar.plates.filter((p) => p >= WARMUP_MIN_PLATE_KG)
  return plates.length > 0 ? { barKg: bar.barKg, plates } : bar
}

/**
 * 본 세트 무게 workingKg에 맞는 웜업 세트들, 가벼운 것부터.
 * bar를 주면 바벨로 보고 올릴 수 있는 무게로 맞추며, 바보다 무겁게 시작하면 맨 앞에 바만 드는 세트를 넣는다.
 * 무게가 겹치는 세트와 본 세트보다 가볍지 않은 세트는 뺀다. 아주 가벼운 무게면 한 세트만 나오거나 비어 있다.
 */
export function planWarmup(workingKg: number, bar: PlateSetup | null = null): WarmupStep[] {
  if (!(workingKg > 0)) return []
  const loading = bar ? warmupSetup(bar) : null
  const steps: WarmupStep[] = []
  for (const { ratio, reps } of WARMUP_STEPS) {
    const raw = workingKg * ratio
    const weightKg = loading ? nearestLoadable(raw, loading) : roundToStep(raw)
    if (weightKg <= 0 || weightKg > workingKg - EPSILON) continue
    if (steps.some((s) => Math.abs(s.weightKg - weightKg) < EPSILON)) continue
    steps.push({ weightKg, reps })
  }
  // 바벨: 첫 세트가 바보다 무거우면 바만 드는 세트로 시작한다.
  const startsAboveBar = steps.length === 0 || steps[0].weightKg > (bar?.barKg ?? 0) + EPSILON
  if (bar && bar.barKg > 0 && bar.barKg < workingKg - EPSILON && startsAboveBar) {
    steps.unshift({ weightKg: bar.barKg, reps: EMPTY_BAR_REPS })
  }
  return steps
}

export interface WarmupPlan {
  /** 기준으로 삼은 본 세트 무게(kg). 무게를 적은 본 세트가 없으면 null */
  workingKg: number | null
  /** 넣을 웜업 세트, 가벼운 것부터 */
  steps: WarmupStep[]
  /** 넣을 때 지워질, 아직 하지 않은 웜업 세트 수 */
  replaces: number
}

/**
 * 지금 세트들을 보고 넣을 웜업 세트를 정한다.
 * 이미 완료한 웜업 세트가 있으면 그 무게보다 무거운 것만 넣는다(이미 한 무게를 다시 넣지 않는다).
 */
export function buildWarmupPlan(
  sets: readonly Pick<SetEntry, 'weightKg' | 'isWarmup' | 'isDone'>[],
  bar: PlateSetup | null = null,
): WarmupPlan {
  const replaces = sets.filter((s) => s.isWarmup && !s.isDone).length
  const workingKg = workingWeight(sets)
  if (workingKg === null) return { workingKg, steps: [], replaces }
  const doneUpTo = Math.max(0, ...sets.filter((s) => s.isWarmup && s.isDone).map((s) => s.weightKg ?? 0))
  const steps = planWarmup(workingKg, bar).filter((s) => s.weightKg > doneUpTo + EPSILON)
  return { workingKg, steps, replaces }
}

/**
 * 웜업 세트를 첫 본 세트 앞에 넣는다(무게와 횟수를 채운, 아직 하지 않은 웜업 세트).
 * 아직 하지 않은 웜업 세트는 지우고 새 것으로 바꾼다. 완료한 세트는 웜업이든 본 세트든 지우지 않는다.
 * 순서 값은 0부터 빈틈없이 다시 매긴다. steps가 비어 있으면 아무것도 바꾸지 않는다.
 */
export async function applyWarmup(workoutExerciseId: string, steps: readonly WarmupStep[]): Promise<void> {
  if (steps.length === 0) return
  await db.transaction('rw', db.sets, async () => {
    const sets = await db.sets.where('workoutExerciseId').equals(workoutExerciseId).sortBy('order')
    const stale = sets.filter((s) => s.isWarmup && !s.isDone)
    const kept = sets.filter((s) => !(s.isWarmup && !s.isDone))
    const firstWorking = kept.findIndex((s) => !s.isWarmup)
    const at = firstWorking < 0 ? kept.length : firstWorking
    const added: SetEntry[] = steps.map((step) => ({
      id: newId(),
      workoutExerciseId,
      order: 0,
      weightKg: step.weightKg,
      reps: step.reps,
      isWarmup: true,
      isDone: false,
    }))
    const next = [...kept.slice(0, at), ...added, ...kept.slice(at)]
    const orderOf = new Map(next.map((s, i) => [s.id, i]))

    await db.sets.bulkDelete(stale.map((s) => s.id))
    await db.sets.bulkAdd(added.map((s) => ({ ...s, order: orderOf.get(s.id) ?? 0 })))
    const moved = kept.flatMap((s) => {
      const order = orderOf.get(s.id) ?? s.order
      return s.order === order ? [] : [{ key: s.id, changes: { order } }]
    })
    await db.sets.bulkUpdate(moved)
  })
}
