import type { Exercise, SetEntry } from '../db'
import { formatKg } from './format'

/**
 * 세트를 무엇으로 재는지와, 맨몸 종목에 더하는 무게. (4단계)
 *
 * - 횟수 종목(기본): 세트의 reps를 쓴다.
 * - 시간 종목(플랭크 등, Exercise.measure가 'time'): 세트의 durationSec(초)를 쓰고 reps는 비워 둔다.
 *   볼륨과 추정 1RM은 계산하지 않고, 가장 오래 버틴 시간을 기록으로 본다.
 * - 맨몸 종목(equipment가 'bodyweight'): 세트의 무게는 몸에 더한 무게(추가 무게)이고, 비어 있으면 맨몸이다.
 *   체중은 알 수 없으니 볼륨에는 추가 무게×횟수만 들어간다.
 *
 * 목표 값을 담는 칸은 횟수와 시간이 같이 쓴다. Exercise.targetReps, WorkoutExercise.targetReps, RoutineItem.reps는
 * 시간 종목이면 목표 시간(초)이다. 칸을 따로 두지 않은 것은 종목마다 둘 중 하나만 쓰기 때문이고,
 * 화면에서는 targetLabel과 formatTarget으로 "목표 60초"처럼 단위를 바꿔 보여 준다.
 */

export type Measure = 'reps' | 'time'

type MeasureSource = Pick<Exercise, 'measure'> | null | undefined
type EquipmentSource = Partial<Pick<Exercise, 'equipment'>> | null | undefined
type SetAmounts = Pick<SetEntry, 'reps' | 'durationSec'>

export const MEASURES: { key: Measure; label: string }[] = [
  { key: 'reps', label: '횟수' },
  { key: 'time', label: '시간' },
]

/** 종목을 무엇으로 재는지. 정하지 않은 종목과 지워진 종목은 횟수. */
export function measureOf(exercise: MeasureSource): Measure {
  return exercise?.measure === 'time' ? 'time' : 'reps'
}

/** 시간으로 재는 종목인지 */
export function isTimed(exercise: MeasureSource): boolean {
  return measureOf(exercise) === 'time'
}

/** 세트의 무게가 "추가 무게"인 종목(맨몸 종목)인지 */
export function usesAddedWeight(exercise: EquipmentSource): boolean {
  return exercise?.equipment === 'bodyweight'
}

/** 세트에 적은 시간(초). 시간 세트가 아니면 0 */
export function setSeconds(s: Pick<SetEntry, 'durationSec'>): number {
  const v = s.durationSec
  return typeof v === 'number' && v > 0 ? v : 0
}

/** 횟수나 시간을 적은 세트인지. 완료로 표시하거나 기록에 넣을 수 있는 세트다. */
export function isSetEntered(s: SetAmounts): boolean {
  return (s.reps ?? 0) > 0 || setSeconds(s) > 0
}

/** 목표 시간으로 받을 수 있는 범위(초) */
export const TARGET_SECONDS_RANGE = { min: 1, max: 600 } as const

/** 시간. 60 → "60초" */
export function formatSeconds(seconds: number): string {
  return `${Math.round(seconds)}초`
}

/** 목표 값의 이름. "목표 횟수" 또는 "목표 시간" */
export function targetLabel(exercise: MeasureSource): string {
  return isTimed(exercise) ? '목표 시간' : '목표 횟수'
}

/** 목표 값을 단위와 함께. "8회" 또는 "60초" */
export function formatTarget(exercise: MeasureSource, target: number): string {
  return isTimed(exercise) ? formatSeconds(target) : `${target}회`
}

/** 무게를 단위와 함께. "60kg", 추가 무게면 "+10kg" */
export function formatWeight(weightKg: number, added = false): string {
  return `${added ? '+' : ''}${formatKg(weightKg)}kg`
}

/**
 * 세트 하나를 짧게. "60×8", 무게가 없으면 "8회", 추가 무게면 "+10×8".
 * 시간 세트는 "60초", 무게를 달았으면 "10kg×60초".
 */
export function formatSetShort(
  s: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec'>,
  opts: { addedWeight?: boolean } = {},
): string {
  const weight = s.weightKg ?? 0
  const sign = opts.addedWeight ? '+' : ''
  const seconds = setSeconds(s)
  if (seconds > 0) return weight > 0 ? `${sign}${formatKg(weight)}kg×${formatSeconds(seconds)}` : formatSeconds(seconds)
  const reps = s.reps ?? 0
  return weight > 0 ? `${sign}${formatKg(weight)}×${reps}` : `${reps}회`
}
