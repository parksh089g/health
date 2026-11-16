import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { SEED_EXERCISES } from '../seed'
import { addCustomExercise, ensureSeedExercises } from './exercises'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('기본 종목', () => {
  it('id와 이름이 겹치지 않는다', () => {
    expect(new Set(SEED_EXERCISES.map((s) => s.id)).size).toBe(SEED_EXERCISES.length)
    expect(new Set(SEED_EXERCISES.map((s) => s.name)).size).toBe(SEED_EXERCISES.length)
  })

  it('여러 번 불러도 한 번만 들어간다', async () => {
    await ensureSeedExercises()
    await ensureSeedExercises()
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('빠진 기본 종목만 채우고 내 종목은 건드리지 않는다', async () => {
    await ensureSeedExercises()
    const mine = await addCustomExercise({ name: '스미스 머신 스쿼트', bodyPart: 'legs', equipment: 'machine' })
    await db.exercises.delete('seed:squat')

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:squat')).toMatchObject({ name: '스쿼트', isCustom: false })
    expect(await db.exercises.get(mine)).toMatchObject({ name: '스미스 머신 스쿼트', isCustom: true })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length + 1)
  })
})

describe('내 종목 추가', () => {
  it('이름 앞뒤와 중간의 남는 공백을 정리한다', async () => {
    const id = await addCustomExercise({ name: '  케틀벨   스윙 ', bodyPart: 'legs', equipment: 'other' })
    expect(await db.exercises.get(id)).toMatchObject({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
  })

  it('같은 이름이 있으면 새로 만들지 않고 그 종목을 돌려준다', async () => {
    await ensureSeedExercises()
    const id = await addCustomExercise({ name: '스쿼트', bodyPart: 'legs', equipment: 'barbell' })
    expect(id).toBe('seed:squat')
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('이름이 비어 있으면 거절한다', async () => {
    await expect(addCustomExercise({ name: '   ', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '종목 이름을 입력해 주세요.',
    )
  })
})
