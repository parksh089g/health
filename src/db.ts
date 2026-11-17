import Dexie, { type Table } from 'dexie'

/** 'cardio'는 유산소(러닝머신, 스텝밀 등). (5단계) */
export type BodyPart = 'chest' | 'back' | 'legs' | 'shoulders' | 'arms' | 'core' | 'cardio' | 'other'

/** assisted: 어시스트 풀업처럼 몸무게를 덜어 주는 보조 머신. 적는 무게는 보조 무게라 낮을수록 어렵다. */
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'assisted' | 'other'

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
  /** 이 종목의 휴식 시간(초). 없으면 설정의 기본 휴식 시간을 쓴다. (4단계) */
  restSeconds?: number | null
  /** 종목 메모(시트 높이, 그립 같은 세팅). 운동 중 카드에 보인다. (4단계) */
  note?: string | null
  /**
   * 세트를 무엇으로 재는지. 없으면 'reps'(횟수). 'time'이면 세트의 durationSec(초)를 쓴다. (4단계)
   * 'cardio'는 유산소: 세트의 durationSec(초)와, cardioMetric에 따라 distanceKm나 floors를 쓴다. (5단계)
   */
  measure?: 'reps' | 'time' | 'cardio' | null
  /**
   * 유산소 종목에서 시간과 함께 적는 값. 'distance'는 거리(km), 'floors'는 오른 층수(스텝밀).
   * 없으면 시간만 적는다. 유산소 종목이 아니면 쓰지 않는다. (5단계)
   */
  cardioMetric?: 'distance' | 'floors' | null
  /** 숨긴 종목. 기록이 있는 종목은 지우는 대신 숨겨서 종목 선택에 나오지 않게 한다. (4단계) */
  archived?: boolean
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
  /**
   * 지난 운동을 나중에 적는 중이면, 마칠 때 끝난 시각으로 쓸 값. 지금 하는 운동은 없음.
   * 이 값이 있으면 휴식 타이머, 스톱워치, 다음 무게 추천을 쓰지 않고, 지난번 기록도 그날 이전 것만 본다. (6단계)
   */
  pastEndAt?: number | null
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
  /**
   * 슈퍼세트 묶음의 id. 순서가 이어진 종목들이 같은 값을 가지면 번갈아 하는 한 묶음이다.
   * 묶지 않은 종목은 없음. (5단계)
   */
  supersetId?: string | null
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
  /** 힘든 정도(RPE) 6~10, 0.5 단위. 적지 않았으면 없음. (4단계) */
  rpe?: number | null
  /** 시간으로 재는 종목(플랭크 등)의 버틴 시간(초), 유산소 종목의 운동 시간(초). 그런 종목이 아니면 없음. (4단계) */
  durationSec?: number | null
  /** 유산소 종목의 거리(km). 거리를 적는 종목이 아니면 없음. (5단계) */
  distanceKm?: number | null
  /** 유산소 종목(스텝밀)에서 오른 층수. 층수를 적는 종목이 아니면 없음. (5단계) */
  floors?: number | null
  /** 유산소 기구의 강도(레벨이나 속도처럼 기구에 표시되는 숫자). 적지 않았으면 없음. (5단계) */
  level?: number | null
}

/** 체중 기록. 하루에 하나만 둔다(같은 날 다시 적으면 덮어쓴다). (4단계) */
export interface BodyWeight {
  /** 로컬 시간 기준 YYYY-MM-DD (이 값이 id) */
  date: string
  weightKg: number
  updatedAt: number
}

/** 루틴 안의 한 종목 */
export interface RoutineItem {
  exerciseId: string
  /** 목표 세트 수(1 이상) */
  sets: number
  /** 목표 횟수. 정하지 않았으면 null */
  reps: number | null
  /** 슈퍼세트 묶음의 id. 이어진 종목들이 같은 값을 가지면 한 묶음이다. 묶지 않았으면 없음. (5단계) */
  supersetId?: string | null
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
  /** 추천 무게(kg). 맨몸 종목이면 null(추가 무게를 쓰는 맨몸 종목이면 추가 무게) */
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

/** 운동을 마친 뒤의 AI 피드백 (4단계) */
export interface AiWorkoutFeedback {
  /** 한 줄 총평 */
  headline: string
  /** 짧은 항목 2~4개(잘한 점, 다음에 해 볼 것) */
  points: string[]
}

/** AI가 제안한 루틴 하나(아직 저장하지 않은 것) (4단계) */
export interface AiRoutineProposal {
  id: string
  name: string
  /** 이렇게 짠 까닭 한 줄 */
  rationale: string
  items: RoutineItem[]
}

/** AI로 루틴 만들기의 가장 최근 제안. 마음에 드는 것만 골라 루틴으로 저장한다. */
export interface AiRoutineDraft {
  /** 사용자가 적은 요청 */
  request: string
  routines: AiRoutineProposal[]
}

/** AI에게 알려 두는 내 목표와 상황. 요청할 때마다 함께 보낸다. (4단계) */
export interface AiProfile {
  goal: 'hypertrophy' | 'strength' | 'fat-loss' | 'health' | null
  experience: 'beginner' | 'intermediate' | 'advanced' | null
  /** 주당 운동 횟수 목표. 정하지 않았으면 null */
  daysPerWeek: number | null
  /** 부상, 피하고 싶은 동작 등 자유롭게 적는 글 */
  notes: string
}

/**
 * AI가 준 답. 다시 열어도 같은 답을 보도록(요금이 다시 나가지 않도록) 폰에 저장한다.
 * 기록에서 다시 만들 수 있으니 백업 파일에는 넣지 않는다. (3단계)
 */
export type AiAdvice =
  | AiAdviceBase<'workout', AiWorkoutAdvice>
  | AiAdviceBase<'review', AiReview>
  | AiAdviceBase<'feedback', AiWorkoutFeedback>
  | AiAdviceBase<'routines', AiRoutineDraft>

interface AiAdviceBase<K extends string, D> {
  /** 'workout:<운동 id>', 'feedback:<운동 id>', 'review' 또는 'routines'(뒤의 둘은 가장 최근 것 하나만 남긴다) */
  id: string
  kind: K
  /** 운동 추천이나 피드백이면 그 운동 id, 분석이면 null */
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
  bodyWeights!: Table<BodyWeight, string>

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
    // 4단계: 체중 기록 테이블 추가. 종목과 세트에 붙은 새 필드는 인덱스가 아니라 그대로 둔다.
    this.version(4).stores({
      bodyWeights: 'date',
    })
    // 5단계(유산소, 슈퍼세트, 주간 목표, 원판 설정)는 인덱스가 아닌 필드와 설정 값만 더해서 스키마를 바꾸지 않았다.
  }
}

export const db = new HealthDB()
