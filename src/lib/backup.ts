import {
  db,
  type BodyWeight,
  type Exercise,
  type Routine,
  type SetEntry,
  type SettingRow,
  type Workout,
  type WorkoutExercise,
} from '../db'
import { toDateKey } from './format'
import { DEVICE_ONLY_SETTING_KEYS, SETTING_KEYS } from './settings'

export const BACKUP_FORMAT = 'health-log-backup'
/**
 * 백업 파일 형식의 버전.
 * 1: MVP. 2: 루틴(routines)을 더했다. 3: 체중 기록(bodyWeights)을 더했다.
 * 4: 유산소 종목과 세트의 거리, 층수, 강도, 슈퍼세트 묶음을 더했다(목록은 그대로이고 필드만 늘었다).
 * 예전 파일도 그대로 읽는다(없는 목록은 빈 목록).
 */
export const BACKUP_VERSION = 4

export interface BackupData {
  exercises: Exercise[]
  workouts: Workout[]
  workoutExercises: WorkoutExercise[]
  sets: SetEntry[]
  settings: SettingRow[]
  routines: Routine[]
  bodyWeights: BodyWeight[]
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  /** ISO 8601 */
  exportedAt: string
  data: BackupData
}

/** 폰에 있는 모든 기록을 백업 파일 내용으로 만든다. */
export async function exportBackup(now: Date = new Date()): Promise<BackupFile> {
  return db.transaction(
    'r',
    [db.exercises, db.workouts, db.workoutExercises, db.sets, db.settings, db.routines, db.bodyWeights],
    async () => ({
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      data: {
        exercises: await db.exercises.toArray(),
        workouts: await db.workouts.toArray(),
        workoutExercises: await db.workoutExercises.toArray(),
        sets: await db.sets.toArray(),
        // API 키처럼 이 폰에만 두는 설정은 백업 파일에 넣지 않는다.
        settings: (await db.settings.toArray()).filter((r) => !DEVICE_ONLY_SETTING_KEYS.includes(r.key)),
        routines: await db.routines.toArray(),
        bodyWeights: await db.bodyWeights.toArray(),
      },
    }),
  )
}

export function backupFileName(now: Date = new Date()): string {
  return `health-backup-${toDateKey(now)}.json`
}

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const isStr = (v: unknown): v is string => typeof v === 'string'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v)
/** 2단계에 더한 선택 필드: 없거나, null이거나, 숫자 */
const isOptNum = (v: unknown): boolean => v === undefined || isNumOrNull(v)
const isOptStr = (v: unknown): boolean => v === undefined || v === null || isStr(v)
const isOptBool = (v: unknown): boolean => v === undefined || isBool(v)

function isRoutineItem(v: unknown): boolean {
  return (
    isRec(v) && isStr(v.exerciseId) && isNum(v.sets) && v.sets >= 1 && isNumOrNull(v.reps) && isOptStr(v.supersetId)
  )
}

function list(data: Rec, key: keyof BackupData, check: (r: Rec) => boolean, optional = false): Rec[] {
  const v = data[key]
  if (v === undefined && optional) return []
  if (!Array.isArray(v)) throw new Error(`백업 파일에 ${key} 목록이 없습니다.`)
  for (const row of v) {
    if (!isRec(row) || !check(row)) throw new Error(`백업 파일의 ${key} 항목 형식이 올바르지 않습니다.`)
  }
  return v as Rec[]
}

/**
 * 백업 파일 내용을 읽고 형식을 확인한다.
 * 이 앱의 백업이 아니거나 내용이 깨졌으면 이유를 담아 오류를 던진다.
 */
export function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('JSON 파일을 읽을 수 없습니다.')
  }
  if (!isRec(raw) || raw.format !== BACKUP_FORMAT) throw new Error('이 앱의 백업 파일이 아닙니다.')
  if (!isNum(raw.version) || raw.version < 1) throw new Error('백업 파일의 버전을 알 수 없습니다.')
  if (raw.version > BACKUP_VERSION) {
    throw new Error('더 새로운 버전의 앱에서 만든 백업입니다. 앱을 업데이트한 뒤 다시 시도해 주세요.')
  }
  if (!isRec(raw.data)) throw new Error('백업 파일에 기록이 들어 있지 않습니다.')
  const d = raw.data

  const exercises = list(
    d,
    'exercises',
    (r) =>
      isStr(r.id) &&
      isStr(r.name) &&
      isStr(r.bodyPart) &&
      isStr(r.equipment) &&
      isBool(r.isCustom) &&
      isNum(r.createdAt) &&
      isOptNum(r.targetReps) &&
      isOptNum(r.incrementKg) &&
      isOptNum(r.restSeconds) &&
      isOptStr(r.note) &&
      isOptStr(r.measure) &&
      isOptStr(r.cardioMetric) &&
      isOptBool(r.archived),
  )
  const workouts = list(
    d,
    'workouts',
    (r) =>
      isStr(r.id) &&
      isStr(r.date) &&
      isNum(r.startedAt) &&
      isNumOrNull(r.endedAt) &&
      isStr(r.memo) &&
      isOptStr(r.routineId),
  )
  const workoutExercises = list(
    d,
    'workoutExercises',
    (r) =>
      isStr(r.id) &&
      isStr(r.workoutId) &&
      isStr(r.exerciseId) &&
      isNum(r.order) &&
      isStr(r.memo) &&
      isOptNum(r.targetReps) &&
      isOptStr(r.supersetId),
  )
  const sets = list(
    d,
    'sets',
    (r) =>
      isStr(r.id) &&
      isStr(r.workoutExerciseId) &&
      isNum(r.order) &&
      isNumOrNull(r.weightKg) &&
      isNumOrNull(r.reps) &&
      isBool(r.isWarmup) &&
      isBool(r.isDone) &&
      isOptNum(r.rpe) &&
      isOptNum(r.durationSec) &&
      isOptNum(r.distanceKm) &&
      isOptNum(r.floors) &&
      isOptNum(r.level),
  )
  const settings = list(d, 'settings', (r) => isStr(r.key))
  // 버전 1 백업에는 루틴이 없다.
  const routines = list(
    d,
    'routines',
    (r) =>
      isStr(r.id) &&
      isStr(r.name) &&
      Array.isArray(r.items) &&
      r.items.every(isRoutineItem) &&
      isNum(r.createdAt) &&
      isNum(r.updatedAt) &&
      isNumOrNull(r.lastUsedAt),
    raw.version < 2,
  )
  // 버전 2까지의 백업에는 체중 기록이 없다.
  const bodyWeights = list(
    d,
    'bodyWeights',
    (r) => isStr(r.date) && isNum(r.weightKg) && r.weightKg > 0 && isNum(r.updatedAt),
    raw.version < 3,
  )

  return {
    format: BACKUP_FORMAT,
    version: raw.version,
    exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '',
    data: {
      exercises: exercises as unknown as Exercise[],
      workouts: workouts as unknown as Workout[],
      workoutExercises: workoutExercises as unknown as WorkoutExercise[],
      sets: sets as unknown as SetEntry[],
      settings: settings as unknown as SettingRow[],
      routines: routines as unknown as Routine[],
      bodyWeights: bodyWeights as unknown as BodyWeight[],
    },
  }
}

/** 지금 있는 기록을 모두 지우고 백업 내용으로 바꾼다. */
export async function importBackup(backup: BackupFile): Promise<void> {
  const { data } = backup
  const exportedAt = Date.parse(backup.exportedAt)

  const tables = [db.exercises, db.workouts, db.workoutExercises, db.sets, db.settings, db.routines, db.aiAdvice, db.bodyWeights]
  await db.transaction('rw', tables, async () => {
    // 이 폰에만 두는 설정(API 키 등)은 복원해도 그대로 남긴다.
    const deviceOnly = (await db.settings.bulkGet([...DEVICE_ONLY_SETTING_KEYS])).filter((r) => r !== undefined)
    await db.sets.clear()
    await db.workoutExercises.clear()
    await db.workouts.clear()
    await db.exercises.clear()
    await db.settings.clear()
    await db.routines.clear()
    await db.bodyWeights.clear()
    // AI 답은 지운 기록을 가리킬 수 있어 함께 지운다.
    await db.aiAdvice.clear()

    await db.exercises.bulkAdd(data.exercises)
    await db.workouts.bulkAdd(data.workouts)
    await db.workoutExercises.bulkAdd(data.workoutExercises)
    await db.sets.bulkAdd(data.sets)
    await db.settings.bulkPut(data.settings.filter((r) => !DEVICE_ONLY_SETTING_KEYS.includes(r.key)))
    await db.settings.bulkPut(deviceOnly)
    await db.routines.bulkAdd(data.routines)
    await db.bodyWeights.bulkAdd(data.bodyWeights)

    // 복원한 기록은 이 백업 파일과 같으므로, 백업한 날짜도 파일을 만든 때로 맞춘다.
    if (Number.isFinite(exportedAt)) {
      await db.settings.put({ key: SETTING_KEYS.lastBackupAt, value: exportedAt })
    }
  })
}
