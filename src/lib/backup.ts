import { db, type Exercise, type SetEntry, type SettingRow, type Workout, type WorkoutExercise } from '../db'
import { toDateKey } from './format'
import { SETTING_KEYS } from './settings'

export const BACKUP_FORMAT = 'health-log-backup'
export const BACKUP_VERSION = 1

export interface BackupData {
  exercises: Exercise[]
  workouts: Workout[]
  workoutExercises: WorkoutExercise[]
  sets: SetEntry[]
  settings: SettingRow[]
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
  return db.transaction('r', db.exercises, db.workouts, db.workoutExercises, db.sets, db.settings, async () => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    data: {
      exercises: await db.exercises.toArray(),
      workouts: await db.workouts.toArray(),
      workoutExercises: await db.workoutExercises.toArray(),
      sets: await db.sets.toArray(),
      settings: await db.settings.toArray(),
    },
  }))
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

function list(data: Rec, key: keyof BackupData, check: (r: Rec) => boolean): Rec[] {
  const v = data[key]
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
    (r) => isStr(r.id) && isStr(r.name) && isStr(r.bodyPart) && isStr(r.equipment) && isBool(r.isCustom) && isNum(r.createdAt),
  )
  const workouts = list(
    d,
    'workouts',
    (r) => isStr(r.id) && isStr(r.date) && isNum(r.startedAt) && isNumOrNull(r.endedAt) && isStr(r.memo),
  )
  const workoutExercises = list(
    d,
    'workoutExercises',
    (r) => isStr(r.id) && isStr(r.workoutId) && isStr(r.exerciseId) && isNum(r.order) && isStr(r.memo),
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
      isBool(r.isDone),
  )
  const settings = list(d, 'settings', (r) => isStr(r.key))

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
    },
  }
}

/** 지금 있는 기록을 모두 지우고 백업 내용으로 바꾼다. */
export async function importBackup(backup: BackupFile): Promise<void> {
  const { data } = backup
  const exportedAt = Date.parse(backup.exportedAt)

  await db.transaction('rw', db.exercises, db.workouts, db.workoutExercises, db.sets, db.settings, async () => {
    await db.sets.clear()
    await db.workoutExercises.clear()
    await db.workouts.clear()
    await db.exercises.clear()
    await db.settings.clear()

    await db.exercises.bulkAdd(data.exercises)
    await db.workouts.bulkAdd(data.workouts)
    await db.workoutExercises.bulkAdd(data.workoutExercises)
    await db.sets.bulkAdd(data.sets)
    await db.settings.bulkPut(data.settings)

    // 복원한 기록은 이 백업 파일과 같으므로, 백업한 날짜도 파일을 만든 때로 맞춘다.
    if (Number.isFinite(exportedAt)) {
      await db.settings.put({ key: SETTING_KEYS.lastBackupAt, value: exportedAt })
    }
  })
}
