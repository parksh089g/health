import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db'
import { ensureSeedExercises } from '../exercises'
import { setSetting, SETTING_KEYS } from '../settings'
import { swapWorkoutExercise } from '../swap'
import { addExercisesToWorkout, completeSet, finishWorkout, loadWorkoutDetail, startWorkout } from '../workouts'
import { saveAiProfile } from './profile'
import { AiError, askClaudeJson } from './client'
import { getAiUsage } from './models'
import {
  buildSwapContext,
  cachedSwap,
  parseSwap,
  requestSwap,
  swapCostText,
  swapModel,
  SWAP_SYSTEM,
  type SwapCandidate,
} from './substitute'

vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>()
  return { ...real, askClaudeJson: vi.fn() }
})
const askMock = vi.mocked(askClaudeJson)

const BENCH = 'seed:bench-press'
const DB_PRESS = 'seed:dumbbell-bench-press'
const CHEST_MACHINE = 'seed:chest-press-machine'
const PUSH_UP = 'seed:push-up'
const SQUAT = 'seed:squat'
const PLANK = 'seed:plank'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 16, 19, 0).getTime()

async function finished(startedAt: number, rows: Record<string, [number | null, number][]>) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, Object.keys(rows))
  const detail = await loadWorkoutDetail(id)
  for (const [exerciseId, sets] of Object.entries(rows)) {
    const weId = detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we.id
    await db.sets.where('workoutExerciseId').equals(weId).delete()
    await db.sets.bulkAdd(
      sets.map(([weightKg, reps], i) => ({
        id: `${id}-${exerciseId}-${i}`,
        workoutExerciseId: weId,
        order: i,
        weightKg,
        reps,
        isWarmup: false,
        isDone: true,
      })),
    )
  }
  await finishWorkout(id, { endedAt: startedAt + 3600_000 })
}

/** 진행 중인 운동을 만들고 종목별 WorkoutExercise id를 돌려준다. */
async function active(exerciseIds: string[]) {
  const id = await startWorkout(NOW)
  await addExercisesToWorkout(id, exerciseIds)
  const detail = await loadWorkoutDetail(id)
  return { id, we: (exerciseId: string) => detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
  askMock.mockReset()
})

describe('모델과 요금', () => {
  it('Opus는 Sonnet으로 낮추고 Sonnet과 Haiku는 그대로 쓴다', () => {
    expect(swapModel('claude-opus-5-5')).toBe('claude-sonnet-5-5')
    expect(swapModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
    expect(swapModel('claude-haiku-5-5')).toBe('claude-haiku-5-5')
    expect(swapCostText('claude-opus-5-5')).toBe('$0.02')
    expect(swapCostText('claude-haiku-5-5')).toBe('$0.01 미만')
  })
})

describe('요청 글', () => {
  it('바꾸는 까닭, 덧붙인 말, 부상 메모와 체중, 같은 부위 종목만 담는다', async () => {
    await finished(NOW - 3 * DAY, { [BENCH]: [[60, 8], [60, 8]], [DB_PRESS]: [[22, 10]] })
    await saveAiProfile({ notes: '왼쪽 어깨가 좋지 않음' })
    await db.bodyWeights.put({ date: '2026-11-15', weightKg: 72.4, updatedAt: 1 })
    const w = await active([BENCH, CHEST_MACHINE, SQUAT])

    const ctx = await buildSwapContext(w.we(BENCH).id, 'pain', '  어깨 앞쪽이\n찌릿해요 ', NOW)
    expect(ctx.prompt).toContain('바꾸려는 종목: 벤치프레스 (가슴, 바벨')
    expect(ctx.prompt).toContain('60kg×8, 60kg×8 · 추정 1RM')
    expect(ctx.prompt).toContain('바꾸는 까닭: 이 동작을 하면 몸이 불편함')
    expect(ctx.prompt).toContain('사용자가 덧붙인 말: 어깨 앞쪽이 찌릿해요')
    expect(ctx.prompt).toContain('참고할 점(부상, 피하고 싶은 동작 등): 왼쪽 어깨가 좋지 않음')
    expect(ctx.prompt).toContain('체중: 72.4kg')
    expect(ctx.prompt).toContain('오늘 할 다른 종목: 체스트 프레스 머신, 스쿼트')

    const ids = ctx.candidates.map((c) => c.exercise.id)
    // 같은 부위만, 오늘 이미 하는 종목과 바꾸려는 종목은 빼고, 최근에 한 종목을 먼저.
    expect(ids[0]).toBe(DB_PRESS)
    expect(ids).toContain(PUSH_UP)
    expect(ids).not.toContain(BENCH)
    expect(ids).not.toContain(CHEST_MACHINE)
    expect(ids).not.toContain(SQUAT)
    expect(ctx.candidates.every((c) => c.exercise.bodyPart === 'chest')).toBe(true)
    expect(ctx.prompt).toMatch(/E1 덤벨 벤치프레스 \(가슴, 덤벨\) · 최근 1회, 마지막 .*22kg×10/)
  })

  it('숨긴 종목과 시간 종목은 고를 수 있는 종목에 넣지 않고, 시간 종목은 바꿀 수 없다', async () => {
    await db.exercises.update(DB_PRESS, { archived: true })
    const w = await active([BENCH, PLANK])
    const ctx = await buildSwapContext(w.we(BENCH).id, 'busy', '', NOW)
    expect(ctx.candidates.map((c) => c.exercise.id)).not.toContain(DB_PRESS)
    expect((await buildSwapContext(w.we(PLANK).id, 'busy', '', NOW)).prompt).toBe('')
  })
})

describe('답 읽기', () => {
  const candidates = (): SwapCandidate[] => [
    { key: 'E1', exercise: { id: DB_PRESS, name: '덤벨 벤치프레스', bodyPart: 'chest', equipment: 'dumbbell', isCustom: false, createdAt: 0 } },
    { key: 'E2', exercise: { id: PUSH_UP, name: '푸시업', bodyPart: 'chest', equipment: 'bodyweight', isCustom: false, createdAt: 0 } },
    { key: 'E3', exercise: { id: CHEST_MACHINE, name: '체스트 프레스 머신', bodyPart: 'chest', equipment: 'machine', isCustom: false, createdAt: 0 } },
    { key: 'E4', exercise: { id: 'seed:cable-fly', name: '케이블 플라이', bodyPart: 'chest', equipment: 'cable', isCustom: false, createdAt: 0 } },
  ]

  it('모르는 key, 같은 종목, 이상한 값은 버리고 3개까지만 둔다', () => {
    const r = parseSwap(
      {
        alternatives: [
          { key: 'E9', weightKg: 20, reps: 10, reason: 'x' },
          { key: 'E1', weightKg: 21.1, reps: 10, reason: '  덤벨은 어깨를 자유롭게 써요 ' },
          { key: 'E1', weightKg: 20, reps: 10, reason: '두 번째' },
          { key: 'E3', weightKg: 40, reps: 0, reason: '횟수 0' },
          { key: 'E2', weightKg: 0, reps: 12, reason: '맨몸' },
          { key: 'E3', weightKg: 45, reps: 10, reason: '' },
          { key: 'E4', weightKg: 10, reps: 12, reason: '넷째' },
        ],
        note: '가볍게 시작해요',
      },
      candidates(),
    )
    expect(r.options.map((o) => [o.exerciseId, o.weightKg, o.reps])).toEqual([
      [DB_PRESS, 21, 10],
      [PUSH_UP, null, 12],
      [CHEST_MACHINE, 45, 10],
    ])
    expect(r.options[0].reason).toBe('덤벨은 어깨를 자유롭게 써요')
    expect(r.options[1].addedWeight).toBe(true)
    expect(r.note).toBe('가볍게 시작해요')
  })

  it('쓸 수 있는 답이 없으면 AI가 남긴 말로 알려 준다', () => {
    expect(() => parseSwap({ alternatives: [], note: '어깨 부담이 없는 가슴 종목이 목록에 없어요' }, candidates())).toThrow(
      '어깨 부담이 없는 가슴 종목이 목록에 없어요',
    )
    expect(() => parseSwap({ nope: 1 }, candidates())).toThrow(AiError)
  })
})

describe('요청하기', () => {
  it('Opus를 골라 두었어도 Sonnet으로 묻고, 요금을 사용량에 더하고, 답을 기억한다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    await setSetting(SETTING_KEYS.aiModel, 'claude-opus-5-5')
    const w = await active([BENCH])
    askMock.mockImplementation(async (req) => {
      const key = (req.schema as { properties: { alternatives: { items: { properties: { key: { enum: string[] } } } } } })
        .properties.alternatives.items.properties.key.enum[0]
      return {
        value: { alternatives: [{ key, weightKg: 20, reps: 10, reason: '기구 없이 할 수 있어요' }], note: '' },
        servedModel: 'claude-sonnet-5-5',
        costUsd: 0.015,
        inputTokens: 2000,
        outputTokens: 1000,
      }
    })
    const r = await requestSwap(w.we(BENCH).id, 'busy', '', NOW)
    expect(askMock).toHaveBeenCalledTimes(1)
    expect(askMock.mock.calls[0][0]).toMatchObject({ model: 'claude-sonnet-5-5', system: SWAP_SYSTEM, apiKey: 'sk-ant-test' })
    expect(r.options).toHaveLength(1)
    expect(cachedSwap(w.we(BENCH).id)).toEqual(r)
    expect((await getAiUsage(NOW)).costUsd).toBeCloseTo(0.015)
  })

  it('같은 부위에 고를 종목이 없으면 묻지 않는다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    await db.exercises.where('bodyPart').equals('chest').modify({ archived: true })
    await db.exercises.update(BENCH, { archived: false })
    const w = await active([BENCH])
    await expect(requestSwap(w.we(BENCH).id, 'busy', '', NOW)).rejects.toThrow('같은 부위에 고를 수 있는 다른 종목이 없습니다')
    expect(askMock).not.toHaveBeenCalled()
  })
})

describe('종목 바꾸기', () => {
  it('세트를 하나도 끝내지 않았으면 그 자리에서 바꾸고, 시작 무게와 횟수를 채운다', async () => {
    const w = await active([SQUAT, BENCH, PUSH_UP])
    const bench = w.we(BENCH)
    await db.workoutExercises.update(bench.id, { supersetId: 'ss1', targetReps: 10 })
    await db.workoutExercises.update(w.we(PUSH_UP).id, { supersetId: 'ss1' })

    const newId = await swapWorkoutExercise(bench.id, DB_PRESS, { weightKg: 22, reps: 10 })
    const detail = await loadWorkoutDetail(w.id)
    expect(detail!.items.map((i) => i.we.exerciseId)).toEqual([SQUAT, DB_PRESS, PUSH_UP])
    const swapped = detail!.items[1]
    expect(swapped.we.id).toBe(newId)
    expect(swapped.we).toMatchObject({ order: 1, supersetId: 'ss1', targetReps: 10 })
    expect(swapped.sets.map((s) => [s.weightKg, s.reps])).toEqual([[22, 10], [22, 10], [22, 10]])
    expect(await db.workoutExercises.get(bench.id)).toBeUndefined()
    expect(await db.sets.where('workoutExerciseId').equals(bench.id).count()).toBe(0)
  })

  it('끝낸 세트가 있으면 기록으로 남기고 남은 세트 수만큼 새 종목을 바로 뒤에 넣는다', async () => {
    const w = await active([BENCH, SQUAT])
    const bench = w.we(BENCH)
    const sets = await db.sets.where('workoutExerciseId').equals(bench.id).sortBy('order')
    await db.sets.update(sets[0].id, { weightKg: 60, reps: 8 })
    await completeSet(sets[0].id)

    await swapWorkoutExercise(bench.id, PUSH_UP, { weightKg: null, reps: 12 })
    const detail = await loadWorkoutDetail(w.id)
    expect(detail!.items.map((i) => [i.we.exerciseId, i.we.order])).toEqual([
      [BENCH, 0],
      [PUSH_UP, 1],
      [SQUAT, 2],
    ])
    expect(detail!.items[0].sets.map((s) => s.isDone)).toEqual([true])
    expect(detail!.items[1].sets.map((s) => [s.weightKg, s.reps])).toEqual([[null, 12], [null, 12]])
  })

  it('이미 이 운동에 있는 종목으로는 바꾸지 않는다', async () => {
    const w = await active([BENCH, DB_PRESS])
    expect(await swapWorkoutExercise(w.we(BENCH).id, DB_PRESS, null)).toBeNull()
    expect((await loadWorkoutDetail(w.id))!.items).toHaveLength(2)
  })
})
