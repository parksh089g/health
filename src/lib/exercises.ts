import { db, type BodyPart, type Equipment, type Exercise } from '../db'
import { SEED_EXERCISES } from '../seed'
import { newId } from './id'
import { isTimed, measureOf, TARGET_SECONDS_RANGE, type Measure } from './measure'
import { REST_RANGE, isRestSeconds } from './settings'

export const BODY_PARTS: { key: BodyPart; label: string }[] = [
  { key: 'chest', label: '가슴' },
  { key: 'back', label: '등' },
  { key: 'legs', label: '하체' },
  { key: 'shoulders', label: '어깨' },
  { key: 'arms', label: '팔' },
  { key: 'core', label: '코어' },
  { key: 'other', label: '기타' },
]

export const EQUIPMENT: { key: Equipment; label: string }[] = [
  { key: 'barbell', label: '바벨' },
  { key: 'dumbbell', label: '덤벨' },
  { key: 'machine', label: '머신' },
  { key: 'cable', label: '케이블' },
  { key: 'bodyweight', label: '맨몸' },
  { key: 'other', label: '기타' },
]

export function bodyPartLabel(key: BodyPart): string {
  return BODY_PARTS.find((b) => b.key === key)?.label ?? '기타'
}

export function equipmentLabel(key: Equipment): string {
  return EQUIPMENT.find((e) => e.key === key)?.label ?? '기타'
}

/** 종목 이름 아래에 붙이는 한 줄. "가슴 · 바벨", 시간 종목은 "코어 · 맨몸 · 시간 종목" */
export function exerciseKindText(exercise: Pick<Exercise, 'bodyPart' | 'equipment' | 'measure'>): string {
  const kind = `${bodyPartLabel(exercise.bodyPart)} · ${equipmentLabel(exercise.equipment)}`
  return isTimed(exercise) ? `${kind} · 시간 종목` : kind
}

/** 이름 비교용: 띄어쓰기와 대소문자를 무시한다. "스티프데드리프트"와 "스티프 데드리프트"는 같은 종목이다. */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, '').toLowerCase()
}

/**
 * 기본 종목 중 아직 없는 것을 넣는다. 앱을 열 때마다 불러도 된다.
 * 이미 있는 종목은 건드리지 않는다. id가 같은 종목이 있으면(숨겼어도) 다시 넣거나 되살리지 않고,
 * 이름이 같은 종목이 있으면(내 종목이든 숨긴 종목이든) 같은 이름을 하나 더 만들지 않는다.
 */
export async function ensureSeedExercises(): Promise<void> {
  await db.transaction('rw', db.exercises, async () => {
    const all = await db.exercises.toArray()
    const have = new Set(all.map((e) => e.id))
    // 사용자가 같은 이름으로 먼저 만든 종목이 있으면 기본 종목을 또 넣지 않는다(목록에 이름이 두 번 나오지 않도록).
    const names = new Set(all.map((e) => nameKey(e.name)))
    const missing = SEED_EXERCISES.filter((s) => !have.has(s.id) && !names.has(nameKey(s.name)))
    if (missing.length === 0) return
    const now = Date.now()
    await db.exercises.bulkAdd(missing.map((s) => ({ ...s, isCustom: false, createdAt: now })))
  })
}

/** 종목 이름의 최대 길이 */
export const EXERCISE_NAME_MAX = 40
/** 종목 메모의 최대 길이 */
export const EXERCISE_NOTE_MAX = 200

export interface ExerciseInput {
  name: string
  bodyPart: BodyPart
  equipment: Equipment
  /** 세트를 횟수로 잴지 시간으로 잴지. 주지 않으면 새 종목은 횟수, 고칠 때는 그대로 둔다. */
  measure?: Measure
}

/** 기록이 있는 종목의 재는 방법을 바꾸려 할 때의 안내 */
export const MEASURE_LOCKED_MESSAGE = '기록이 있는 종목은 횟수와 시간을 바꿀 수 없습니다.'

/** 이름의 앞뒤와 중간의 남는 공백을 정리하고 확인한다. */
function cleanName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name === '') throw new Error('종목 이름을 입력해 주세요.')
  if (name.length > EXERCISE_NAME_MAX) throw new Error(`종목 이름은 ${EXERCISE_NAME_MAX}자까지 쓸 수 있습니다.`)
  return name
}

/**
 * 내 종목 추가. 같은 이름(띄어쓰기, 대소문자 무시)이 이미 있으면 그 종목의 id를 돌려준다.
 * 그 종목이 숨겨져 있었으면 다시 보이게 한다.
 * 다만 이미 있는 종목이 재는 방법(횟수/시간)이 다르면, 다른 방식의 종목을 말없이 쓰게 되지 않도록 오류를 던진다.
 */
export async function addCustomExercise(input: ExerciseInput): Promise<string> {
  const name = cleanName(input.name)

  return db.transaction('rw', db.exercises, async () => {
    const all = await db.exercises.toArray()
    const same = all.find((e) => nameKey(e.name) === nameKey(name))
    if (same) {
      if (input.measure !== undefined && input.measure !== measureOf(same)) {
        const how = isTimed(same) ? '시간으로' : '횟수로'
        const hidden = same.archived ? '(숨김)' : ''
        throw new Error(
          `이미 있는 "${same.name}" 종목${hidden}은 ${how} 기록합니다. 그 종목을 쓰거나 다른 이름으로 만들어 주세요.`,
        )
      }
      if (same.archived) await db.exercises.update(same.id, { archived: false })
      return same.id
    }
    const id = newId()
    const exercise: Exercise = {
      id,
      name,
      bodyPart: input.bodyPart,
      equipment: input.equipment,
      isCustom: true,
      createdAt: Date.now(),
    }
    // 횟수 종목은 칸을 비워 둔다(없으면 횟수).
    if (input.measure === 'time') exercise.measure = 'time'
    await db.exercises.add(exercise)
    return id
  })
}

/**
 * 내 종목의 이름, 부위, 기구, 재는 방법(횟수/시간)을 바꾼다. 기록은 종목 id를 가리키므로 그대로 따라온다.
 * 다른 종목과 이름이 같으면(띄어쓰기, 대소문자 무시. 숨긴 종목 포함) 오류를 던진다.
 *
 * 재는 방법은 이 종목을 한 운동이 하나도 없을 때만 바꿀 수 있다(이미 적은 횟수나 시간이 뜻을 잃지 않게).
 * 바꾸면 목표 값의 단위도 달라지므로 종목의 목표와 루틴에 정해 둔 목표는 지운다.
 */
export async function updateCustomExercise(exerciseId: string, input: ExerciseInput): Promise<void> {
  const name = cleanName(input.name)

  await db.transaction('rw', [db.exercises, db.workoutExercises, db.routines], async () => {
    const all = await db.exercises.toArray()
    const exercise = all.find((e) => e.id === exerciseId)
    if (!exercise) throw new Error('종목을 찾을 수 없습니다.')
    if (!exercise.isCustom) throw new Error('기본 종목은 이름을 바꿀 수 없습니다.')
    const same = all.find((e) => e.id !== exerciseId && nameKey(e.name) === nameKey(name))
    if (same) {
      throw new Error(same.archived ? '같은 이름의 숨긴 종목이 있습니다.' : '같은 이름의 종목이 이미 있습니다.')
    }
    const changes: Partial<Exercise> = { name, bodyPart: input.bodyPart, equipment: input.equipment }
    if (input.measure !== undefined && input.measure !== measureOf(exercise)) {
      const records = await db.workoutExercises.where('exerciseId').equals(exerciseId).count()
      if (records > 0) throw new Error(MEASURE_LOCKED_MESSAGE)
      changes.measure = input.measure
      changes.targetReps = null
      // 루틴의 고친 시각은 그대로 둔다(홈에서 루틴 순서가 바뀌지 않게).
      for (const routine of await db.routines.toArray()) {
        if (!routine.items.some((item) => item.exerciseId === exerciseId && item.reps !== null)) continue
        const items = routine.items.map((item) => (item.exerciseId === exerciseId ? { ...item, reps: null } : item))
        await db.routines.update(routine.id, { items })
      }
    }
    await db.exercises.update(exerciseId, changes)
  })
}

/** 종목이 얼마나 쓰였는지. 지울지 숨길지를 정하고 안내할 때 쓴다. */
export interface ExerciseUsage {
  /** 이 종목을 한 운동 수(진행 중인 운동 포함) */
  records: number
  /** 이 종목이 들어 있는 루틴 수 */
  routines: number
}

export async function getExerciseUsage(exerciseId: string): Promise<ExerciseUsage> {
  const records = await db.workoutExercises.where('exerciseId').equals(exerciseId).count()
  const routines = await db.routines.filter((r) => r.items.some((item) => item.exerciseId === exerciseId)).count()
  return { records, routines }
}

/**
 * 종목을 없앨 때 정말 지울지('delete') 숨길지('archive').
 * 기록이 없는 내 종목만 지운다. 기록이 있는 종목과 기본 종목은 숨긴다
 * (기록의 이름이 사라지지 않게, 기본 종목이 다음에 열 때 되살아나지 않게).
 */
export function removalKind(exercise: Pick<Exercise, 'isCustom'>, records: number): 'delete' | 'archive' {
  return exercise.isCustom && records === 0 ? 'delete' : 'archive'
}

/**
 * 종목을 없앤다. 기록이 없는 내 종목은 정말 지우고 루틴에서도 뺀다.
 * 그 밖의 종목은 숨긴다: 종목 선택에는 나오지 않고, 기록과 통계와 루틴에는 그대로 남는다.
 */
export async function removeExercise(exerciseId: string): Promise<'deleted' | 'archived'> {
  return db.transaction('rw', [db.exercises, db.workoutExercises, db.routines], async () => {
    const exercise = await db.exercises.get(exerciseId)
    if (!exercise) throw new Error('종목을 찾을 수 없습니다.')
    const records = await db.workoutExercises.where('exerciseId').equals(exerciseId).count()
    if (removalKind(exercise, records) === 'archive') {
      await db.exercises.update(exerciseId, { archived: true })
      return 'archived'
    }
    // 루틴의 고친 시각은 그대로 둔다(홈에서 루틴 순서가 바뀌지 않게).
    for (const routine of await db.routines.toArray()) {
      const items = routine.items.filter((item) => item.exerciseId !== exerciseId)
      if (items.length !== routine.items.length) await db.routines.update(routine.id, { items })
    }
    await db.exercises.delete(exerciseId)
    return 'deleted'
  })
}

/** 숨긴 종목을 다시 보이게 한다. */
export async function restoreExercise(exerciseId: string): Promise<void> {
  const updated = await db.exercises.update(exerciseId, { archived: false })
  if (updated === 0 && !(await db.exercises.get(exerciseId))) throw new Error('종목을 찾을 수 없습니다.')
}

export interface ExerciseFilter {
  /** 이름으로 찾는 말. 띄어쓰기 없이 찾아도 나온다("스티프데드" → "스티프 데드리프트"). */
  query?: string
  bodyPart?: BodyPart | 'all'
}

function filterByName(exercises: Exercise[], { query = '', bodyPart = 'all' }: ExerciseFilter): Exercise[] {
  const q = nameKey(query)
  return exercises
    .filter((e) => (bodyPart === 'all' || e.bodyPart === bodyPart) && (q === '' || nameKey(e.name).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/** 종목 선택(운동에 추가, 루틴에 넣기)에 보일 종목. 숨긴 종목은 빼고 이름순으로 늘어놓는다. */
export function pickableExercises(exercises: Exercise[], filter: ExerciseFilter = {}): Exercise[] {
  return filterByName(
    exercises.filter((e) => !e.archived),
    filter,
  )
}

/** 숨긴 종목. 이름순. */
export function hiddenExercises(exercises: Exercise[], filter: ExerciseFilter = {}): Exercise[] {
  return filterByName(
    exercises.filter((e) => e.archived === true),
    filter,
  )
}

/** 무게를 올릴 때의 기본 단위(kg). 하체는 5, 나머지는 2.5. */
export const DEFAULT_INCREMENT_KG = { legs: 5, other: 2.5 } as const

/** 이 종목에서 무게를 올릴 때의 단위(kg). 종목에 정해 둔 값이 없으면 부위로 정한다. */
export function incrementFor(exercise: Pick<Exercise, 'bodyPart' | 'incrementKg'>): number {
  const own = exercise.incrementKg
  if (typeof own === 'number' && own > 0) return own
  return exercise.bodyPart === 'legs' ? DEFAULT_INCREMENT_KG.legs : DEFAULT_INCREMENT_KG.other
}

/** 목표 횟수로 받을 수 있는 범위 */
export const TARGET_REPS_RANGE = { min: 1, max: 100 } as const
/** 증량 단위로 받을 수 있는 범위(kg) */
export const INCREMENT_RANGE = { min: 0.25, max: 50 } as const

/** 목표 값(횟수 종목은 횟수, 시간 종목은 초)으로 받을 수 있는 범위 */
export function targetRange(exercise: Pick<Exercise, 'measure'> | null | undefined): { min: number; max: number } {
  return isTimed(exercise) ? TARGET_SECONDS_RANGE : TARGET_REPS_RANGE
}

/** 목표 값이 범위를 벗어났을 때의 안내. "목표 횟수는 1~100회로", "목표 시간은 1~600초로" */
export function targetRangeText(exercise: Pick<Exercise, 'measure'> | null | undefined): string {
  const { min, max } = targetRange(exercise)
  return isTimed(exercise) ? `목표 시간은 ${min}~${max}초로` : `목표 횟수는 ${min}~${max}회로`
}

/**
 * 종목의 목표 횟수(시간 종목은 목표 시간)와 증량 단위를 바꾼다. null을 주면 정한 값을 지우고 기본값으로 돌아간다.
 * 범위를 벗어나면 오류를 던진다.
 */
export async function updateExerciseGoal(
  exerciseId: string,
  patch: { targetReps?: number | null; incrementKg?: number | null },
): Promise<void> {
  const changes: Partial<Pick<Exercise, 'targetReps' | 'incrementKg'>> = {}
  if (patch.targetReps !== undefined) {
    const v = patch.targetReps
    // 시간 종목이면 목표 시간(초)이라 받는 범위가 다르다.
    const exercise = v === null ? undefined : await db.exercises.get(exerciseId)
    const range = targetRange(exercise)
    if (v !== null && !(Number.isInteger(v) && v >= range.min && v <= range.max)) {
      throw new Error(`${targetRangeText(exercise)} 정해 주세요.`)
    }
    changes.targetReps = v
  }
  if (patch.incrementKg !== undefined) {
    const v = patch.incrementKg
    if (v !== null && !(Number.isFinite(v) && v >= INCREMENT_RANGE.min && v <= INCREMENT_RANGE.max)) {
      throw new Error(`증량 단위는 ${INCREMENT_RANGE.min}~${INCREMENT_RANGE.max}kg로 정해 주세요.`)
    }
    changes.incrementKg = v
  }
  const updated = await db.exercises.update(exerciseId, changes)
  if (updated === 0 && Object.keys(changes).length > 0 && !(await db.exercises.get(exerciseId))) {
    throw new Error('종목을 찾을 수 없습니다.')
  }
}

/**
 * 이 종목의 휴식 시간(초)을 정한다. null을 주면 지우고 설정의 기본 휴식 시간으로 돌아간다.
 * 범위를 벗어나면 오류를 던진다.
 */
export async function updateExerciseRest(exerciseId: string, restSeconds: number | null): Promise<void> {
  if (restSeconds !== null && !isRestSeconds(restSeconds)) {
    throw new Error(`휴식 시간은 ${REST_RANGE.min}~${REST_RANGE.max}초로 정해 주세요.`)
  }
  const updated = await db.exercises.update(exerciseId, { restSeconds })
  if (updated === 0 && !(await db.exercises.get(exerciseId))) throw new Error('종목을 찾을 수 없습니다.')
}

/**
 * 종목 메모(시트 높이, 그립 같은 세팅)를 바꾼다. 앞뒤 공백은 지우고, 비우면 메모를 없앤다.
 * 너무 길면 오류를 던진다.
 */
export async function updateExerciseNote(exerciseId: string, note: string): Promise<void> {
  const text = note.trim()
  if (text.length > EXERCISE_NOTE_MAX) throw new Error(`메모는 ${EXERCISE_NOTE_MAX}자까지 쓸 수 있습니다.`)
  const updated = await db.exercises.update(exerciseId, { note: text === '' ? null : text })
  if (updated === 0 && !(await db.exercises.get(exerciseId))) throw new Error('종목을 찾을 수 없습니다.')
}
