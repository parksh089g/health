import { db, type BodyPart, type Equipment } from '../db'
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
