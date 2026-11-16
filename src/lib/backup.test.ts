import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { BACKUP_FORMAT, BACKUP_VERSION, backupFileName, exportBackup, importBackup, parseBackup } from './backup'
import { ensureSeedExercises } from './exercises'
import { SETTING_KEYS, getLastBackupAt, getRestSeconds, setSetting } from './settings'
import { addExercisesToWorkout, finishWorkout, loadWorkoutDetail, startWorkout, updateSet } from './workouts'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
})

async function recordOne(startedAt: number, weightKg: number) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, ['seed:squat'])
  const detail = await loadWorkoutDetail(id)
  const set = detail!.items[0].sets[0]
  await updateSet(set.id, { weightKg, reps: 5, isDone: true })
  await finishWorkout(id, { endedAt: startedAt + 1_000, memo: '메모' })
  return id
}

async function dump() {
  const backup = await exportBackup()
  const sortById = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return {
    exercises: sortById(backup.data.exercises),
    workouts: sortById(backup.data.workouts),
    workoutExercises: sortById(backup.data.workoutExercises),
    sets: sortById(backup.data.sets),
  }
}

describe('백업과 복원', () => {
  it('내보낸 파일을 다시 넣으면 기록이 그대로 돌아온다', async () => {
    await recordOne(1_000, 60)
    await recordOne(10_000_000, 62.5)
    await setSetting(SETTING_KEYS.restSeconds, 120)
    const before = await dump()
    const text = JSON.stringify(await exportBackup(new Date('2026-11-16T12:00:00Z')))

    await db.delete()
    await db.open()
    await importBackup(parseBackup(text))

    expect(await dump()).toEqual(before)
    expect(await getRestSeconds()).toBe(120)
  })

  it('복원하면 지금 있는 기록은 지워지고 백업 내용으로 바뀐다', async () => {
    const old = await recordOne(1_000, 60)
    const text = JSON.stringify(await exportBackup())
    const added = await recordOne(10_000_000, 100)

    await importBackup(parseBackup(text))

    expect(await db.workouts.get(old)).toBeDefined()
    expect(await db.workouts.get(added)).toBeUndefined()
    expect(await db.sets.count()).toBe(1)
  })

  it('복원한 뒤 마지막 백업 날짜는 그 파일을 만든 때가 된다', async () => {
    const exportedAt = new Date('2026-11-01T09:00:00Z')
    const text = JSON.stringify(await exportBackup(exportedAt))
    await setSetting(SETTING_KEYS.lastBackupAt, 123)

    await importBackup(parseBackup(text))

    expect(await getLastBackupAt()).toBe(exportedAt.getTime())
  })

  it('넣는 도중 실패하면 기존 기록을 그대로 둔다', async () => {
    const id = await recordOne(1_000, 60)
    const backup = await exportBackup()
    backup.data.sets.push({ ...backup.data.sets[0] }) // 같은 id가 두 번 들어 있는 깨진 백업

    await expect(importBackup(backup)).rejects.toThrow()

    expect(await db.workouts.get(id)).toBeDefined()
    expect(await db.sets.count()).toBe(1)
    expect(await db.exercises.count()).toBeGreaterThan(0)
  })

  it('파일 이름에 날짜가 들어간다', () => {
    expect(backupFileName(new Date(2026, 10, 6))).toBe('health-backup-2026-11-06.json')
  })
})

describe('백업 파일 검사', () => {
  const valid = () => ({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-11-16T12:00:00.000Z',
    data: { exercises: [], workouts: [], workoutExercises: [], sets: [], settings: [] },
  })

  it('형식이 맞는 파일은 통과한다', () => {
    expect(parseBackup(JSON.stringify(valid())).data.workouts).toEqual([])
  })

  it('JSON이 아니면 거절한다', () => {
    expect(() => parseBackup('백업 아님')).toThrow('JSON 파일을 읽을 수 없습니다.')
  })

  it('다른 파일이면 거절한다', () => {
    expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow('이 앱의 백업 파일이 아닙니다.')
    expect(() => parseBackup('[1, 2, 3]')).toThrow('이 앱의 백업 파일이 아닙니다.')
  })

  it('더 새로운 버전에서 만든 백업이면 거절한다', () => {
    const file = { ...valid(), version: BACKUP_VERSION + 1 }
    expect(() => parseBackup(JSON.stringify(file))).toThrow('더 새로운 버전')
  })

  it('목록이 빠져 있으면 거절한다', () => {
    const file = valid()
    delete (file.data as Partial<typeof file.data>).sets
    expect(() => parseBackup(JSON.stringify(file))).toThrow('sets 목록이 없습니다.')
  })

  it('항목의 형식이 틀리면 거절한다', () => {
    const file = valid()
    ;(file.data.workouts as unknown[]).push({ id: 'w1', date: '2026-11-16', startedAt: '어제', endedAt: null, memo: '' })
    expect(() => parseBackup(JSON.stringify(file))).toThrow('workouts 항목 형식이 올바르지 않습니다.')
  })
})
