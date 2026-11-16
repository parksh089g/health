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
}

/** 운동 안에서 한 종목과 그 순서 */
export interface WorkoutExercise {
  id: string
  workoutId: string
  exerciseId: string
  order: number
  memo: string
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

export interface SettingRow {
  key: string
  value: unknown
}

export class HealthDB extends Dexie {
  exercises!: Table<Exercise, string>
  workouts!: Table<Workout, string>
  workoutExercises!: Table<WorkoutExercise, string>
  sets!: Table<SetEntry, string>
  settings!: Table<SettingRow, string>

  constructor(name = 'health-log') {
    super(name)
    this.version(1).stores({
      exercises: 'id, name, bodyPart',
      workouts: 'id, date, startedAt',
      workoutExercises: 'id, workoutId, exerciseId',
      sets: 'id, workoutExerciseId',
      settings: 'key',
    })
  }
}

export const db = new HealthDB()
