import type { Exercise, SetEntry } from '../db'
import { formatKg } from './format'

/**
 * 세트를 무엇으로 재는지와, 맨몸 종목에 더하는 무게. (4단계, 유산소는 5단계)
 *
 * - 횟수 종목(기본): 세트의 reps를 쓴다.
 * - 시간 종목(플랭크 등, Exercise.measure가 'time'): 세트의 durationSec(초)를 쓰고 reps는 비워 둔다.
 *   볼륨과 추정 1RM은 계산하지 않고, 가장 오래 버틴 시간을 기록으로 본다.
 * - 유산소 종목(러닝머신, 스텝밀 등, Exercise.measure가 'cardio'): 세트의 durationSec(초)를 쓰고,
 *   Exercise.cardioMetric에 따라 distanceKm(거리)나 floors(층수)를 함께 적는다. level은 기구의 강도(선택).
 *   무게와 횟수는 비워 두고, 볼륨과 추천과 목표 값이 없다. 화면에서는 시간을 분으로 적고 "12분 30초"처럼 보여 준다.
 * - 맨몸 종목(equipment가 'bodyweight'): 세트의 무게는 몸에 더한 무게(추가 무게)이고, 비어 있으면 맨몸이다.
 *   체중은 알 수 없으니 볼륨에는 추가 무게×횟수만 들어간다.
 *
 * 목표 값을 담는 칸은 횟수와 시간이 같이 쓴다. Exercise.targetReps, WorkoutExercise.targetReps, RoutineItem.reps는
 * 시간 종목이면 목표 시간(초)이다. 칸을 따로 두지 않은 것은 종목마다 둘 중 하나만 쓰기 때문이고,
 * 화면에서는 targetLabel과 formatTarget으로 "목표 60초"처럼 단위를 바꿔 보여 준다.
 */

export type Measure = 'reps' | 'time' | 'cardio'
/** 유산소 종목에서 시간과 함께 적는 값. 거리(km)나 층수 */
export type CardioMetric = 'distance' | 'floors'

type MeasureSource = Pick<Exercise, 'measure'> | null | undefined
type CardioSource = Pick<Exercise, 'measure' | 'cardioMetric'> | null | undefined
type EquipmentSource = Partial<Pick<Exercise, 'equipment'>> | null | undefined
type SetAmounts = Pick<SetEntry, 'reps' | 'durationSec'>
type CardioAmounts = Pick<SetEntry, 'durationSec' | 'distanceKm' | 'floors' | 'level'>

export const MEASURES: { key: Measure; label: string }[] = [
  { key: 'reps', label: '횟수' },
  { key: 'time', label: '시간' },
  { key: 'cardio', label: '유산소' },
]

/** 유산소 종목을 만들 때 고르는 "시간과 함께 적을 값". 'none'은 시간만 */
export const CARDIO_METRICS: { key: CardioMetric | 'none'; label: string }[] = [
  { key: 'distance', label: '거리(km)' },
  { key: 'floors', label: '층수' },
  { key: 'none', label: '시간만' },
]

/** 종목을 무엇으로 재는지. 정하지 않은 종목과 지워진 종목은 횟수. */
export function measureOf(exercise: MeasureSource): Measure {
  const m = exercise?.measure
  return m === 'time' || m === 'cardio' ? m : 'reps'
}

/**
 * 세트에 횟수 대신 시간을 적는 종목인지. 시간 종목(플랭크)과 유산소 종목이 모두 해당한다.
 * 무게×횟수 추천을 받지 않는 종목을 가릴 때도 이것을 쓴다.
 */
export function isTimed(exercise: MeasureSource): boolean {
  return measureOf(exercise) !== 'reps'
}

/** 유산소 종목인지 */
export function isCardio(exercise: MeasureSource): boolean {
  return measureOf(exercise) === 'cardio'
}

/** 목표 값(목표 횟수나 목표 시간)을 두는 종목인지. 유산소에는 목표가 없다. */
export function hasTarget(exercise: MeasureSource): boolean {
  return !isCardio(exercise)
}

/** 유산소 종목에서 시간과 함께 적는 값. 시간만 적거나 유산소 종목이 아니면 null */
export function cardioMetricOf(exercise: CardioSource): CardioMetric | null {
  if (!isCardio(exercise)) return null
  const m = exercise?.cardioMetric
  return m === 'distance' || m === 'floors' ? m : null
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

/** 세트에 적은 거리(km). 적지 않았으면 0 */
export function setDistance(s: Pick<SetEntry, 'distanceKm'>): number {
  const v = s.distanceKm
  return typeof v === 'number' && v > 0 ? v : 0
}

/** 세트에 적은 층수. 적지 않았으면 0 */
export function setFloors(s: Pick<SetEntry, 'floors'>): number {
  const v = s.floors
  return typeof v === 'number' && v > 0 ? v : 0
}

/**
 * 횟수나 시간을 적은 세트인지. 완료로 표시하거나 기록에 넣을 수 있는 세트다.
 * 유산소 세트도 시간이 있어야 한다(거리나 층수만 적은 세트는 아직 적지 않은 세트로 본다).
 */
export function isSetEntered(s: SetAmounts): boolean {
  return (s.reps ?? 0) > 0 || setSeconds(s) > 0
}

/** 유산소 시간 칸에 보여 줄 분(소수 둘째 자리까지). 750 → 12.5 */
export function secondsToMinutes(seconds: number): number {
  return Math.round((seconds / 60) * 100) / 100
}

/** 유산소 시간 칸에 적은 분을 초로. 12.5 → 750 */
export function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60)
}

/** 목표 시간으로 받을 수 있는 범위(초) */
export const TARGET_SECONDS_RANGE = { min: 1, max: 600 } as const

/** 시간. 60 → "60초" */
export function formatSeconds(seconds: number): string {
  return `${Math.round(seconds)}초`
}

/** 유산소 시간. 1800 → "30분", 750 → "12분 30초", 45 → "45초", 5400 → "1시간 30분" */
export function formatCardioTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}시간`)
  if (m > 0) parts.push(`${m}분`)
  if (sec > 0) parts.push(`${sec}초`)
  return parts.length > 0 ? parts.join(' ') : '0분'
}

/** 거리. 5.25 → "5.25km" */
export function formatDistance(km: number): string {
  return `${formatKg(km)}km`
}

/** 층수. 120 → "120층", 1200 → "1,200층" */
export function formatFloors(floors: number): string {
  return `${Math.round(floors).toLocaleString('ko-KR')}층`
}

/**
 * 유산소 세트에 적은 값을 차례로. ["30분", "120층"], 강도까지 넣으면 ["30분", "120층", "강도 8"].
 * 시간을 적지 않은 세트는 적은 것만 담는다(아무것도 없으면 빈 배열).
 */
export function cardioSetParts(s: CardioAmounts, opts: { level?: boolean } = {}): string[] {
  const parts: string[] = []
  if (setSeconds(s) > 0) parts.push(formatCardioTime(setSeconds(s)))
  if (setDistance(s) > 0) parts.push(formatDistance(setDistance(s)))
  if (setFloors(s) > 0) parts.push(formatFloors(setFloors(s)))
  if (opts.level && typeof s.level === 'number' && s.level > 0) parts.push(`강도 ${formatKg(s.level)}`)
  return parts
}

/** 세트를 글로 쓸 때 필요한 종목 정보 */
export interface SetTextOptions {
  /** 맨몸 종목이라 무게가 추가 무게인지 */
  addedWeight?: boolean
  /** 유산소 종목인지. 시간을 "30분"처럼 쓰고 거리나 층수를 붙인다. */
  cardio?: boolean
}

/** 이 종목의 세트를 글로 쓸 때의 옵션 */
export function setTextOptions(
  exercise: (Pick<Exercise, 'measure'> & Partial<Pick<Exercise, 'equipment'>>) | null | undefined,
): SetTextOptions {
  return { addedWeight: usesAddedWeight(exercise), cardio: isCardio(exercise) }
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
 * 시간 세트는 "60초", 무게를 달았으면 "10kg×60초". 유산소 세트(opts.cardio)는 "30분 120층", "25분 5.2km".
 */
export function formatSetShort(
  s: Pick<SetEntry, 'weightKg' | 'reps' | 'durationSec' | 'distanceKm' | 'floors'>,
  opts: SetTextOptions = {},
): string {
  if (opts.cardio) return cardioSetParts(s).join(' ') || '0분'
  const weight = s.weightKg ?? 0
  const sign = opts.addedWeight ? '+' : ''
  const seconds = setSeconds(s)
  if (seconds > 0) return weight > 0 ? `${sign}${formatKg(weight)}kg×${formatSeconds(seconds)}` : formatSeconds(seconds)
  const reps = s.reps ?? 0
  return weight > 0 ? `${sign}${formatKg(weight)}×${reps}` : `${reps}회`
}
