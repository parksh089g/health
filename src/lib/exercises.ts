import { db, type BodyPart, type Equipment, type Exercise } from '../db'
import { SEED_EXERCISES } from '../seed'
import { newId } from './id'

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

/** 기본 종목 중 아직 없는 것을 넣는다. 앱을 열 때마다 불러도 된다. */
export async function ensureSeedExercises(): Promise<void> {
  await db.transaction('rw', db.exercises, async () => {
    const have = new Set(await db.exercises.toCollection().primaryKeys())
    const missing = SEED_EXERCISES.filter((s) => !have.has(s.id))
    if (missing.length === 0) return
    const now = Date.now()
    await db.exercises.bulkAdd(missing.map((s) => ({ ...s, isCustom: false, createdAt: now })))
  })
}

/** 내 종목 추가. 같은 이름이 이미 있으면 그 종목의 id를 돌려준다. */
export async function addCustomExercise(input: {
  name: string
  bodyPart: BodyPart
  equipment: Equipment
}): Promise<string> {
  const name = input.name.trim().replace(/\s+/g, ' ')
  if (name === '') throw new Error('종목 이름을 입력해 주세요.')
  if (name.length > 40) throw new Error('종목 이름은 40자까지 쓸 수 있습니다.')

  return db.transaction('rw', db.exercises, async () => {
    const all = await db.exercises.toArray()
    const same = all.find((e) => e.name.toLowerCase() === name.toLowerCase())
    if (same) return same.id
    const id = newId()
    await db.exercises.add({
      id,
      name,
      bodyPart: input.bodyPart,
      equipment: input.equipment,
      isCustom: true,
      createdAt: Date.now(),
    })
    return id
  })
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

/**
 * 종목의 목표 횟수와 증량 단위를 바꾼다. null을 주면 정한 값을 지우고 기본값으로 돌아간다.
 * 범위를 벗어나면 오류를 던진다.
 */
export async function updateExerciseGoal(
  exerciseId: string,
  patch: { targetReps?: number | null; incrementKg?: number | null },
): Promise<void> {
  const changes: Partial<Pick<Exercise, 'targetReps' | 'incrementKg'>> = {}
  if (patch.targetReps !== undefined) {
    const v = patch.targetReps
    if (v !== null && !(Number.isInteger(v) && v >= TARGET_REPS_RANGE.min && v <= TARGET_REPS_RANGE.max)) {
      throw new Error(`목표 횟수는 ${TARGET_REPS_RANGE.min}~${TARGET_REPS_RANGE.max}회로 정해 주세요.`)
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
