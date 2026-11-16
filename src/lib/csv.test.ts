import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { CSV_COLUMNS, csvCell, csvFileName, exportCsv } from './csv'
import { ensureSeedExercises } from './exercises'
import { addExercisesToWorkout, finishWorkout, loadWorkoutDetail, startWorkout, updateSet } from './workouts'

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
})

function parseLines(csv: string): string[] {
  expect(csv.startsWith('﻿')).toBe(true)
  return csv.slice(1).split('\r\n').filter((l) => l !== '')
}

describe('CSV 칸', () => {
  it('특수 문자가 있으면 따옴표로 감싼다', () => {
    expect(csvCell('스쿼트')).toBe('스쿼트')
    expect(csvCell('가볍게, 천천히')).toBe('"가볍게, 천천히"')
    expect(csvCell('"좋음"')).toBe('"""좋음"""')
    expect(csvCell('첫 줄\n둘째 줄')).toBe('"첫 줄\n둘째 줄"')
    expect(csvCell(62.5)).toBe('62.5')
    expect(csvCell(null)).toBe('')
  })

  it('수식으로 읽힐 수 있는 글자는 막는다', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('-5kg 감량')).toBe("'-5kg 감량")
    expect(csvCell(-5)).toBe('-5')
  })
})

describe('CSV 내보내기', () => {
  it('끝난 운동의 완료 세트만 한 줄씩 쓴다', async () => {
    const id = await startWorkout(new Date(2026, 10, 16, 19, 5).getTime())
    await addExercisesToWorkout(id, ['seed:squat', 'seed:pull-up'])
    const detail = await loadWorkoutDetail(id)
    const [squat, pullUp] = detail!.items
    await updateSet(squat.sets[0].id, { weightKg: 20, reps: 10, isWarmup: true, isDone: true })
    await updateSet(squat.sets[1].id, { weightKg: 60, reps: 8, isDone: true })
    await updateSet(squat.sets[2].id, { weightKg: 62.5, reps: 6 }) // 완료 안 함
    await updateSet(pullUp.sets[0].id, { reps: 10, isDone: true })
    await finishWorkout(id, { memo: '컨디션 좋음, 다음엔 65', endedAt: Date.now() })
    await startWorkout() // 진행 중인 운동은 빠진다

    const lines = parseLines(await exportCsv())
    expect(lines).toEqual([
      CSV_COLUMNS.join(','),
      '2026-11-16,오후 7:05,스쿼트,하체,바벨,W,예,20,10,"컨디션 좋음, 다음엔 65"',
      '2026-11-16,오후 7:05,스쿼트,하체,바벨,1,,60,8,"컨디션 좋음, 다음엔 65"',
      '2026-11-16,오후 7:05,풀업,등,맨몸,1,,,10,"컨디션 좋음, 다음엔 65"',
    ])
  })

  it('기록이 없으면 머리줄만 있다', async () => {
    expect(parseLines(await exportCsv())).toEqual([CSV_COLUMNS.join(',')])
  })

  it('파일 이름에 날짜가 들어간다', () => {
    expect(csvFileName(new Date(2026, 10, 6))).toBe('health-records-2026-11-06.csv')
  })
})
