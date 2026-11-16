import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { SEED_EXERCISES } from '../seed'
import {
  EXERCISE_NOTE_MAX,
  addCustomExercise,
  ensureSeedExercises,
  getExerciseUsage,
  hiddenExercises,
  nameKey,
  pickableExercises,
  removalKind,
  removeExercise,
  restoreExercise,
  updateCustomExercise,
  updateExerciseNote,
  updateExerciseRest,
} from './exercises'
import { REST_RANGE } from './settings'

/** 끝난 운동 하나에 이 종목을 한 기록을 넣는다. */
async function addRecord(exerciseId: string, workoutId = 'w1'): Promise<void> {
  await db.workouts.put({ id: workoutId, date: '2026-11-02', startedAt: 1000, endedAt: 2000, memo: '' })
  await db.workoutExercises.add({ id: `${workoutId}:${exerciseId}`, workoutId, exerciseId, order: 0, memo: '' })
  await db.sets.add({
    id: `${workoutId}:${exerciseId}:1`,
    workoutExerciseId: `${workoutId}:${exerciseId}`,
    order: 0,
    weightKg: 60,
    reps: 8,
    isWarmup: false,
    isDone: true,
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('기본 종목', () => {
  it('id와 이름이 겹치지 않는다', () => {
    expect(new Set(SEED_EXERCISES.map((s) => s.id)).size).toBe(SEED_EXERCISES.length)
    expect(new Set(SEED_EXERCISES.map((s) => nameKey(s.name))).size).toBe(SEED_EXERCISES.length)
  })

  it('이미 쓰던 폰에도 새로 더한 기본 종목이 들어간다', async () => {
    // 예전 목록(스티프 데드리프트 없음)으로 쓰던 상태
    await ensureSeedExercises()
    await db.exercises.bulkDelete(['seed:stiff-leg-deadlift', 'seed:front-squat'])

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:stiff-leg-deadlift')).toMatchObject({
      name: '스티프 데드리프트',
      bodyPart: 'legs',
      equipment: 'barbell',
      isCustom: false,
    })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('같은 이름의 내 종목이 먼저 있으면 기본 종목을 또 넣지 않는다', async () => {
    const mine = await addCustomExercise({ name: '스티프데드리프트', bodyPart: 'legs', equipment: 'barbell' })

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:stiff-leg-deadlift')).toBeUndefined()
    expect(await db.exercises.get(mine)).toMatchObject({ name: '스티프데드리프트', isCustom: true })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('여러 번 불러도 한 번만 들어간다', async () => {
    await ensureSeedExercises()
    await ensureSeedExercises()
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('빠진 기본 종목만 채우고 내 종목은 건드리지 않는다', async () => {
    await ensureSeedExercises()
    const mine = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await db.exercises.delete('seed:squat')

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:squat')).toMatchObject({ name: '스쿼트', isCustom: false })
    expect(await db.exercises.get(mine)).toMatchObject({ name: '케틀벨 스윙', isCustom: true })
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
    // 띄어쓰기만 다른 이름도 같은 종목으로 본다.
    expect(await addCustomExercise({ name: '스티프데드리프트', bodyPart: 'legs', equipment: 'barbell' })).toBe(
      'seed:stiff-leg-deadlift',
    )
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('이름이 비어 있으면 거절한다', async () => {
    await expect(addCustomExercise({ name: '   ', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '종목 이름을 입력해 주세요.',
    )
  })

  it('같은 이름의 숨긴 종목이 있으면 새로 만들지 않고 다시 보이게 한다', async () => {
    await ensureSeedExercises()
    await removeExercise('seed:squat')
    expect(await addCustomExercise({ name: '스쿼트', bodyPart: 'legs', equipment: 'barbell' })).toBe('seed:squat')
    expect(await db.exercises.get('seed:squat')).toMatchObject({ archived: false, isCustom: false })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })
})

describe('내 종목 고치기', () => {
  it('이름, 부위, 기구를 바꾸고 기록은 그대로 따라온다', async () => {
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await addRecord(id)

    await updateCustomExercise(id, { name: '  러시안   스윙 ', bodyPart: 'back', equipment: 'dumbbell' })

    expect(await db.exercises.get(id)).toMatchObject({
      id,
      name: '러시안 스윙',
      bodyPart: 'back',
      equipment: 'dumbbell',
      isCustom: true,
    })
    expect(await getExerciseUsage(id)).toEqual({ records: 1, routines: 0 })
  })

  it('다른 종목과 같은 이름으로는 바꿀 수 없다', async () => {
    await ensureSeedExercises()
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    const other = await addCustomExercise({ name: '불가리안 백', bodyPart: 'legs', equipment: 'other' })

    await expect(updateCustomExercise(id, { name: '스쿼트', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '같은 이름의 종목이 이미 있습니다.',
    )
    // 띄어쓰기와 대소문자만 다른 이름도 같은 이름이다.
    await expect(updateCustomExercise(id, { name: '불가리안백', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '같은 이름의 종목이 이미 있습니다.',
    )
    expect(await db.exercises.get(id)).toMatchObject({ name: '케틀벨 스윙' })
    expect(await db.exercises.get(other)).toMatchObject({ name: '불가리안 백' })
  })

  it('숨긴 종목과 같은 이름으로도 바꿀 수 없다', async () => {
    await ensureSeedExercises()
    await removeExercise('seed:squat')
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await expect(updateCustomExercise(id, { name: '스쿼트', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '같은 이름의 숨긴 종목이 있습니다.',
    )
  })

  it('자기 이름의 띄어쓰기만 고치거나 부위만 바꾸는 것은 된다', async () => {
    const id = await addCustomExercise({ name: '케틀벨스윙', bodyPart: 'legs', equipment: 'other' })
    await updateCustomExercise(id, { name: '케틀벨 스윙', bodyPart: 'back', equipment: 'other' })
    expect(await db.exercises.get(id)).toMatchObject({ name: '케틀벨 스윙', bodyPart: 'back' })
  })

  it('이름이 비었거나 너무 길면 거절한다', async () => {
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await expect(updateCustomExercise(id, { name: ' ', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '종목 이름을 입력해 주세요.',
    )
    await expect(
      updateCustomExercise(id, { name: '가'.repeat(41), bodyPart: 'legs', equipment: 'other' }),
    ).rejects.toThrow('종목 이름은 40자까지 쓸 수 있습니다.')
  })

  it('기본 종목과 없는 종목은 바꿀 수 없다', async () => {
    await ensureSeedExercises()
    await expect(
      updateCustomExercise('seed:squat', { name: '백 스쿼트', bodyPart: 'legs', equipment: 'barbell' }),
    ).rejects.toThrow('기본 종목은 이름을 바꿀 수 없습니다.')
    expect(await db.exercises.get('seed:squat')).toMatchObject({ name: '스쿼트' })
    await expect(updateCustomExercise('nope', { name: '아무거나', bodyPart: 'legs', equipment: 'other' })).rejects.toThrow(
      '종목을 찾을 수 없습니다.',
    )
  })
})

describe('종목 지우기와 숨기기', () => {
  it('기록이 없는 내 종목만 지우고, 나머지는 숨긴다', () => {
    expect(removalKind({ isCustom: true }, 0)).toBe('delete')
    expect(removalKind({ isCustom: true }, 3)).toBe('archive')
    expect(removalKind({ isCustom: false }, 0)).toBe('archive')
    expect(removalKind({ isCustom: false }, 3)).toBe('archive')
  })

  it('기록이 없는 내 종목은 정말 지우고 루틴에서도 뺀다', async () => {
    await ensureSeedExercises()
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await db.routines.bulkAdd([
      {
        id: 'r1',
        name: '하체 날',
        items: [
          { exerciseId: 'seed:squat', sets: 4, reps: 5 },
          { exerciseId: id, sets: 3, reps: 15 },
          { exerciseId: 'seed:leg-press', sets: 3, reps: 10 },
        ],
        createdAt: 1,
        updatedAt: 5,
        lastUsedAt: null,
      },
      {
        id: 'r2',
        name: '스윙만',
        items: [{ exerciseId: id, sets: 5, reps: 20 }],
        createdAt: 2,
        updatedAt: 6,
        lastUsedAt: 7,
      },
      {
        id: 'r3',
        name: '가슴 날',
        items: [{ exerciseId: 'seed:bench-press', sets: 4, reps: 8 }],
        createdAt: 3,
        updatedAt: 8,
        lastUsedAt: null,
      },
    ])
    expect(await getExerciseUsage(id)).toEqual({ records: 0, routines: 2 })

    expect(await removeExercise(id)).toBe('deleted')

    expect(await db.exercises.get(id)).toBeUndefined()
    // 다른 종목의 순서와 값, 루틴의 고친 시각은 그대로다.
    expect(await db.routines.get('r1')).toMatchObject({
      items: [
        { exerciseId: 'seed:squat', sets: 4, reps: 5 },
        { exerciseId: 'seed:leg-press', sets: 3, reps: 10 },
      ],
      updatedAt: 5,
    })
    // 종목이 하나도 남지 않은 루틴도 지우지는 않는다(사용자가 다시 채우거나 지운다).
    expect(await db.routines.get('r2')).toMatchObject({ name: '스윙만', items: [], updatedAt: 6, lastUsedAt: 7 })
    expect(await db.routines.get('r3')).toMatchObject({ items: [{ exerciseId: 'seed:bench-press', sets: 4, reps: 8 }] })
  })

  it('기록이 있는 내 종목은 숨기고, 기록과 루틴은 그대로 둔다', async () => {
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await addRecord(id)
    await db.routines.add({
      id: 'r1',
      name: '하체 날',
      items: [{ exerciseId: id, sets: 3, reps: 15 }],
      createdAt: 1,
      updatedAt: 5,
      lastUsedAt: null,
    })

    expect(await removeExercise(id)).toBe('archived')

    expect(await db.exercises.get(id)).toMatchObject({ name: '케틀벨 스윙', isCustom: true, archived: true })
    expect(await db.workoutExercises.where('exerciseId').equals(id).count()).toBe(1)
    expect(await db.sets.count()).toBe(1)
    expect(await db.routines.get('r1')).toMatchObject({ items: [{ exerciseId: id, sets: 3, reps: 15 }] })
  })

  it('진행 중인 운동에만 들어 있어도 지우지 않고 숨긴다', async () => {
    const id = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await db.workouts.add({ id: 'now', date: '2026-11-16', startedAt: 1000, endedAt: null, memo: '' })
    await db.workoutExercises.add({ id: 'we', workoutId: 'now', exerciseId: id, order: 0, memo: '' })

    expect(await removeExercise(id)).toBe('archived')
    expect(await db.exercises.get(id)).toMatchObject({ archived: true })
  })

  it('기본 종목은 기록이 없어도 숨긴다', async () => {
    await ensureSeedExercises()
    expect(await removeExercise('seed:squat')).toBe('archived')
    expect(await db.exercises.get('seed:squat')).toMatchObject({ name: '스쿼트', isCustom: false, archived: true })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('숨긴 종목을 다시 보이게 한다', async () => {
    await ensureSeedExercises()
    await removeExercise('seed:squat')
    await restoreExercise('seed:squat')
    expect(await db.exercises.get('seed:squat')).toMatchObject({ archived: false })
    expect(pickableExercises(await db.exercises.toArray()).some((e) => e.id === 'seed:squat')).toBe(true)
  })

  it('없는 종목은 오류', async () => {
    await expect(removeExercise('nope')).rejects.toThrow('종목을 찾을 수 없습니다.')
    await expect(restoreExercise('nope')).rejects.toThrow('종목을 찾을 수 없습니다.')
  })
})

describe('종목 선택 목록', () => {
  it('숨긴 종목은 나오지 않고 숨긴 종목 목록에만 나온다', async () => {
    await ensureSeedExercises()
    const mine = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await addRecord(mine)
    await removeExercise(mine)
    await removeExercise('seed:squat')

    const all = await db.exercises.toArray()
    const shown = pickableExercises(all)
    expect(shown).toHaveLength(SEED_EXERCISES.length - 1)
    expect(shown.some((e) => e.id === 'seed:squat' || e.id === mine)).toBe(false)
    expect(hiddenExercises(all).map((e) => e.name)).toEqual(['스쿼트', '케틀벨 스윙'])
  })

  it('부위와 이름으로 거르고 이름순으로 늘어놓는다', async () => {
    await ensureSeedExercises()
    const all = await db.exercises.toArray()

    const legs = pickableExercises(all, { bodyPart: 'legs' })
    expect(legs.length).toBeGreaterThan(0)
    expect(legs.every((e) => e.bodyPart === 'legs')).toBe(true)
    expect(legs.map((e) => e.name)).toEqual([...legs.map((e) => e.name)].sort((a, b) => a.localeCompare(b, 'ko')))

    // 띄어쓰기 없이 찾아도 나온다.
    expect(pickableExercises(all, { query: '스티프데드' }).map((e) => e.id)).toEqual(['seed:stiff-leg-deadlift'])
    expect(pickableExercises(all, { query: '스티프데드', bodyPart: 'chest' })).toEqual([])
  })

  it('숨긴 종목은 이름으로 찾아도 종목 선택에 나오지 않는다', async () => {
    await ensureSeedExercises()
    await removeExercise('seed:stiff-leg-deadlift')
    const all = await db.exercises.toArray()
    expect(pickableExercises(all, { query: '스티프' })).toEqual([])
    expect(hiddenExercises(all, { query: '스티프' }).map((e) => e.id)).toEqual(['seed:stiff-leg-deadlift'])
    expect(hiddenExercises(all, { query: '벤치' })).toEqual([])
  })
})

describe('기본 종목 맞추기와 숨긴 종목, 이름을 바꾼 종목', () => {
  it('숨긴 기본 종목을 되살리거나 하나 더 만들지 않는다', async () => {
    await ensureSeedExercises()
    await removeExercise('seed:squat')
    const before = await db.exercises.get('seed:squat')

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:squat')).toEqual(before)
    expect(before).toMatchObject({ archived: true })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
    expect((await db.exercises.toArray()).filter((e) => nameKey(e.name) === nameKey('스쿼트'))).toHaveLength(1)
  })

  it('숨긴 내 종목과 이름이 같은 기본 종목을 넣지 않는다', async () => {
    const mine = await addCustomExercise({ name: '스티프데드리프트', bodyPart: 'legs', equipment: 'barbell' })
    await addRecord(mine)
    expect(await removeExercise(mine)).toBe('archived')

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:stiff-leg-deadlift')).toBeUndefined()
    expect(await db.exercises.get(mine)).toMatchObject({ name: '스티프데드리프트', archived: true })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length)
  })

  it('이름을 바꾼 내 종목은 그대로 두고 다시 만들지 않는다', async () => {
    await ensureSeedExercises()
    const mine = await addCustomExercise({ name: '케틀벨 스윙', bodyPart: 'legs', equipment: 'other' })
    await updateCustomExercise(mine, { name: '러시안 스윙', bodyPart: 'back', equipment: 'other' })
    await updateExerciseNote(mine, '16kg')

    await ensureSeedExercises()
    await ensureSeedExercises()

    expect(await db.exercises.get(mine)).toMatchObject({ name: '러시안 스윙', bodyPart: 'back', note: '16kg' })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length + 1)
  })

  it('기본 종목과 같은 이름이던 내 종목의 이름을 바꾸면, 그 기본 종목이 한 번만 들어간다', async () => {
    const mine = await addCustomExercise({ name: '스티프데드리프트', bodyPart: 'legs', equipment: 'barbell' })
    await ensureSeedExercises()
    expect(await db.exercises.get('seed:stiff-leg-deadlift')).toBeUndefined()

    await updateCustomExercise(mine, { name: '내 방식 데드리프트', bodyPart: 'legs', equipment: 'barbell' })
    await ensureSeedExercises()
    await ensureSeedExercises()

    expect(await db.exercises.get(mine)).toMatchObject({ name: '내 방식 데드리프트', isCustom: true })
    expect(await db.exercises.get('seed:stiff-leg-deadlift')).toMatchObject({ name: '스티프 데드리프트', isCustom: false })
    expect(await db.exercises.count()).toBe(SEED_EXERCISES.length + 1)
  })

  it('내 종목의 이름을 아직 없는 기본 종목의 이름으로 바꿔도 그 이름이 둘이 되지 않는다', async () => {
    // 예전 목록(스티프 데드리프트 없음)으로 쓰던 폰
    await ensureSeedExercises()
    await db.exercises.delete('seed:stiff-leg-deadlift')
    const mine = await addCustomExercise({ name: '루마니안 변형', bodyPart: 'legs', equipment: 'barbell' })
    await updateCustomExercise(mine, { name: '스티프 데드리프트', bodyPart: 'legs', equipment: 'barbell' })

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:stiff-leg-deadlift')).toBeUndefined()
    expect((await db.exercises.toArray()).filter((e) => nameKey(e.name) === nameKey('스티프 데드리프트'))).toHaveLength(1)
  })

  it('설정을 바꾼 기본 종목의 값도 덮어쓰지 않는다', async () => {
    await ensureSeedExercises()
    await updateExerciseRest('seed:squat', 240)
    await updateExerciseNote('seed:squat', '바 높이 5번')

    await ensureSeedExercises()

    expect(await db.exercises.get('seed:squat')).toMatchObject({ restSeconds: 240, note: '바 높이 5번' })
  })
})

describe('종목 휴식 시간', () => {
  it('정하고, null로 지운다', async () => {
    await ensureSeedExercises()
    await updateExerciseRest('seed:squat', 240)
    expect(await db.exercises.get('seed:squat')).toMatchObject({ restSeconds: 240 })
    await updateExerciseRest('seed:squat', null)
    expect(await db.exercises.get('seed:squat')).toMatchObject({ restSeconds: null })
  })

  it('범위를 벗어나거나 정수가 아니면 거절하고 값을 그대로 둔다', async () => {
    await ensureSeedExercises()
    await updateExerciseRest('seed:squat', 180)
    const message = `휴식 시간은 ${REST_RANGE.min}~${REST_RANGE.max}초로 정해 주세요.`
    await expect(updateExerciseRest('seed:squat', REST_RANGE.min - 1)).rejects.toThrow(message)
    await expect(updateExerciseRest('seed:squat', REST_RANGE.max + 1)).rejects.toThrow(message)
    await expect(updateExerciseRest('seed:squat', 90.5)).rejects.toThrow(message)
    expect(await db.exercises.get('seed:squat')).toMatchObject({ restSeconds: 180 })
  })

  it('없는 종목은 오류', async () => {
    await expect(updateExerciseRest('nope', 120)).rejects.toThrow('종목을 찾을 수 없습니다.')
  })
})

describe('종목 메모', () => {
  it('앞뒤 공백을 지우고 저장하고, 비우면 없앤다', async () => {
    await ensureSeedExercises()
    await updateExerciseNote('seed:lat-pulldown', '  시트 4칸, 와이드 그립\n무릎 패드 2  ')
    expect(await db.exercises.get('seed:lat-pulldown')).toMatchObject({ note: '시트 4칸, 와이드 그립\n무릎 패드 2' })
    await updateExerciseNote('seed:lat-pulldown', '   ')
    expect(await db.exercises.get('seed:lat-pulldown')).toMatchObject({ note: null })
  })

  it(`${EXERCISE_NOTE_MAX}자까지 받고, 넘으면 거절한다`, async () => {
    await ensureSeedExercises()
    await updateExerciseNote('seed:squat', '가'.repeat(EXERCISE_NOTE_MAX))
    await expect(updateExerciseNote('seed:squat', '가'.repeat(EXERCISE_NOTE_MAX + 1))).rejects.toThrow(
      `메모는 ${EXERCISE_NOTE_MAX}자까지 쓸 수 있습니다.`,
    )
    expect((await db.exercises.get('seed:squat'))?.note).toHaveLength(EXERCISE_NOTE_MAX)
  })

  it('없는 종목은 오류', async () => {
    await expect(updateExerciseNote('nope', '메모')).rejects.toThrow('종목을 찾을 수 없습니다.')
  })
})
