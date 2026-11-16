import Dexie, { type Table } from 'dexie'

export type BodyPart = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'other'

export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other'

/** 종목 */
export interface Exercise {
  id: string
  name: string
  bodyPart: BodyPart
  equipment: Equipment
  /** 내가 직접 추가한 종목이면 true */
  isCustom: boolean
  createdAt: number
  /**
   * 목표 횟수. 다음 무게 추천이 "모든 세트에서 이 횟수를 채웠는지"를 볼 때 쓴다.
   * 없으면(undefined 또는 null) 루틴의 목표 횟수나 지난 기록에서 정한다. (2단계)
   */
  targetReps?: number | null
  /** 무게를 올릴 때의 단위(kg). 없으면 부위로 정한다(하체 5, 나머지 2.5). (2단계) */
  incrementKg?: number | null
}

/** 하루 한 번의 운동 */
export interface Workout {
  id: string
  /** 로컬 시간 기준 YYYY-MM-DD */
  date: string
  startedAt: number
  /** 진행 중이면 null */
  endedAt: number | null
  memo: string
  /** 루틴으로 시작했으면 그 루틴의 id (2단계) */
  routineId?: string | null
}

/** 운동 안에서 한 종목과 그 순서 */
export interface WorkoutExercise {
  id: string
  workoutId: string
  exerciseId: string
  order: number
  memo: string
  /** 이 운동에서의 목표 횟수. 루틴으로 시작했을 때 루틴에서 가져온다. (2단계) */
  targetReps?: number | null
}

/** 세트 */
export interface SetEntry {
  id: string
  workoutExerciseId: string
  order: number
  /** 아직 입력하지 않았으면 null */
  weightKg: number | null
  reps: number | null
  isWarmup: boolean
  isDone: boolean
}

/** 루틴 안의 한 종목 */
export interface RoutineItem {
  exerciseId: string
  /** 목표 세트 수(1 이상) */
  sets: number
  /** 목표 횟수. 정하지 않았으면 null */
  reps: number | null
}

/** 루틴(종목 묶음). "하체 날"처럼 자주 하는 구성을 저장해 두고 한 번에 시작한다. (2단계) */
export interface Routine {
  id: string
  name: string
  /** 순서대로 */
  items: RoutineItem[]
  createdAt: number
  updatedAt: number
  /** 마지막으로 이 루틴으로 운동을 시작한 시각. 아직 없으면 null */
  lastUsedAt: number | null
}

export interface SettingRow {
  key: string
  value: unknown
}

/** AI(Claude)가 오늘 운동의 한 종목에 제안한 값 */
export interface AiExerciseSuggestion {
  workoutExerciseId: string
  /** 추천 무게(kg). 맨몸 종목이면 null */
  weightKg: number | null
  reps: number
  reason: string
  /** 적용할 때 바꿀 세트의 무게(지난번 최고 무게). 피라미드의 가벼운 세트는 그대로 둔다. */
  fromWeightKg: number | null
}

export interface AiWorkoutAdvice {
  /** 오늘 운동 전체에 대한 한두 문장 */
  summary: string
  exercises: AiExerciseSuggestion[]
}

/** AI 기록 분석 */
export interface AiReview {
  /** 한 줄 요약 */
  headline: string
  /** 잘하고 있는 점 */
  good: string[]
  /** 살펴볼 점 */
  watch: string[]
  /** 다음 몇 주 동안 해 볼 것 */
  suggestions: string[]
}

/**
 * AI가 준 답. 다시 열어도 같은 답을 보도록(요금이 다시 나가지 않도록) 폰에 저장한다.
 * 기록에서 다시 만들 수 있으니 백업 파일에는 넣지 않는다. (3단계)
 */
export type AiAdvice =
  | AiAdviceBase<'workout', AiWorkoutAdvice>
  | AiAdviceBase<'review', AiReview>

interface AiAdviceBase<K extends string, D> {
  /** 'workout:<운동 id>' 또는 'review'(가장 최근 분석 하나만 남긴다) */
  id: string
  kind: K
  /** 운동 추천이면 그 운동 id, 분석이면 null */
  workoutId: string | null
  createdAt: number
  /** 실제로 답한 모델 */
  model: string
  /** 추정 요금(달러) */
  costUsd: number
  data: D
}

export class HealthDB extends Dexie {
  exercises!: Table<Exercise, string>
  workouts!: Table<Workout, string>
  workoutExercises!: Table<WorkoutExercise, string>
  sets!: Table<SetEntry, string>
  settings!: Table<SettingRow, string>
  routines!: Table<Routine, string>
  aiAdvice!: Table<AiAdvice, string>

  constructor(name = 'health-log') {
    super(name)
    this.version(1).stores({
      exercises: 'id, name, bodyPart',
      workouts: 'id, date, startedAt',
      workoutExercises: 'id, workoutId, exerciseId',
      sets: 'id, workoutExerciseId',
      settings: 'key',
    })
    // 2단계: 루틴 테이블 추가. 기존 테이블은 그대로라 옮길 데이터가 없다.
    // (종목, 운동, 종목 기록에 붙은 새 필드는 인덱스가 아니어서 스키마를 바꿀 필요가 없다.)
    this.version(2).stores({
      routines: 'id, name, updatedAt',
    })
    // 3단계: AI가 준 답을 저장하는 테이블 추가. 기존 테이블은 그대로다.
    this.version(3).stores({
      aiAdvice: 'id, kind, workoutId',
    })
  }
}

export const db = new HealthDB()
