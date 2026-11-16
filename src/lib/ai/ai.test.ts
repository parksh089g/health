import Anthropic from '@anthropic-ai/sdk'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db'
import { exportBackup, importBackup } from '../backup'
import { ensureSeedExercises } from '../exercises'
import { applyRecommendation, isRecommendationApplied } from '../recommend'
import { getAiApiKey, setSetting, SETTING_KEYS } from '../settings'
import { addExercisesToWorkout, deleteWorkout, finishWorkout, loadWorkoutDetail, startWorkout, updateWorkoutMemo } from '../workouts'
import {
  getReview,
  getWorkoutAdvice,
  parseReview,
  parseWorkoutAdvice,
  requestReview,
  requestWorkoutAdvice,
  REVIEW_SCHEMA,
  workoutSchema,
} from './advice'
import { AiError, answerText, askClaudeJson, costOfUsage, toAiError } from './client'
import { applyFromWeight, buildReviewContext, buildWorkoutContext, type WorkoutContextItem } from './context'
import { addAiUsage, estimateCostUsd, formatUsd, getAiUsage } from './models'

vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>()
  return { ...real, askClaudeJson: vi.fn() }
})
const askMock = vi.mocked(askClaudeJson)

const BENCH = 'seed:bench-press'
const PULL_UP = 'seed:pull-up'
const SQUAT = 'seed:squat'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 16, 19, 0).getTime()

type Row = [weightKg: number | null, reps: number | null, opts?: { warmup?: boolean; done?: boolean }]

async function record(startedAt: number, rowsByExercise: Record<string, Row[]>, opts: { finish?: boolean; memo?: string } = {}) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, Object.keys(rowsByExercise))
  const detail = await loadWorkoutDetail(id)
  const weIds: Record<string, string> = {}
  for (const [exerciseId, rows] of Object.entries(rowsByExercise)) {
    const weId = detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we.id
    weIds[exerciseId] = weId
    await db.sets.where('workoutExerciseId').equals(weId).delete()
    await db.sets.bulkAdd(
      rows.map(([weightKg, reps, o], i) => ({
        id: `${id}-${exerciseId}-${i}`,
        workoutExerciseId: weId,
        order: i,
        weightKg,
        reps,
        isWarmup: o?.warmup ?? false,
        isDone: o?.done ?? true,
      })),
    )
  }
  if (opts.memo) await updateWorkoutMemo(id, opts.memo)
  if (opts.finish ?? true) await finishWorkout(id, { endedAt: startedAt + 3600_000, memo: opts.memo })
  return { id, weIds }
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
  askMock.mockReset()
})

describe('운동 추천 요청 글', () => {
  it('종목마다 key, 오늘 세트, 규칙 추천, 지난 기록을 담는다', async () => {
    await record(NOW - 7 * DAY, { [BENCH]: [[40, 10, { warmup: true }], [60, 8], [60, 8], [60, 8]], [PULL_UP]: [[null, 10], [null, 9]] })
    await record(NOW - 2 * DAY, { [BENCH]: [[60, 8], [60, 8], [60, 8], [50, 12]] }, { memo: '어깨가 조금 뻐근함' })
    const today = await record(NOW, { [BENCH]: [[60, 8, { done: false }], [60, 8, { done: false }]], [PULL_UP]: [[null, 9, { done: false }]], [SQUAT]: [[null, null, { done: false }]] }, { finish: false })

    const ctx = await buildWorkoutContext(today.id, NOW)
    expect(ctx.items.map((i) => i.key)).toEqual(['E1', 'E2', 'E3'])
    expect(ctx.items[0]).toMatchObject({ workoutExerciseId: today.weIds[BENCH], fromWeightKg: 60, bodyweight: false })
    expect(ctx.items[1]).toMatchObject({ fromWeightKg: null, bodyweight: true })
    expect(ctx.items[2]).toMatchObject({ fromWeightKg: null, bodyweight: false })

    const p = ctx.prompt
    expect(p).toContain('오늘: 2026-11-16(월)')
    expect(p).toContain('지난 운동: 2026-11-14(토), 2일 전')
    expect(p).toContain('어깨가 조금 뻐근함')
    expect(p).toContain('[E1] 벤치프레스 (가슴, 바벨 · 목표 횟수 정하지 않음 · 증량 단위 2.5kg)')
    expect(p).toContain('오늘 세트: 60kg×8, 60kg×8')
    expect(p).toContain('앱의 규칙 추천: 62.5kg × 8')
    expect(p).toContain('- 2026-11-09(월): 웜업 40kg×10 / 60kg×8, 60kg×8, 60kg×8 · 추정 1RM 76kg')
    expect(p).toContain('[E2] 풀업 (등, 맨몸 · 목표 횟수 정하지 않음)')
    expect(p).toContain('[E3] 스쿼트')
    expect(p).toContain('지난 기록: 없음(처음 하는 종목)')
  })

  it('API 키는 글에 들어가지 않는다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-secret-1234')
    const today = await record(NOW, { [BENCH]: [[60, 8, { done: false }]] }, { finish: false })
    expect((await buildWorkoutContext(today.id, NOW)).prompt).not.toContain('sk-ant')
  })
})

describe('운동 추천 답 읽기', () => {
  const items: WorkoutContextItem[] = [
    { key: 'E1', workoutExerciseId: 'we-bench', fromWeightKg: 60, bodyweight: false },
    { key: 'E2', workoutExerciseId: 'we-pull', fromWeightKg: null, bodyweight: true },
    { key: 'E3', workoutExerciseId: 'we-squat', fromWeightKg: 100, bodyweight: false },
  ]

  it('key를 종목으로 바꾸고 이상한 답은 버린다', () => {
    const advice = parseWorkoutAdvice(
      {
        summary: '  오늘은 가볍게 시작해요. ',
        exercises: [
          { key: 'E1', weightKg: 62.6, reps: 8, reason: '지난번 모두 채웠어요' },
          { key: 'E1', weightKg: 70, reps: 8, reason: '두 번째 답은 버린다' },
          { key: 'E2', weightKg: 10, reps: 11, reason: '맨몸은 무게를 없앤다' },
          { key: 'E3', weightKg: 100, reps: 0, reason: '횟수 0은 버린다' },
          { key: 'E9', weightKg: 50, reps: 5, reason: '모르는 종목' },
        ],
      },
      items,
    )
    expect(advice.summary).toBe('오늘은 가볍게 시작해요.')
    expect(advice.exercises).toEqual([
      { workoutExerciseId: 'we-bench', weightKg: 62.5, reps: 8, reason: '지난번 모두 채웠어요', fromWeightKg: 60 },
      { workoutExerciseId: 'we-pull', weightKg: null, reps: 11, reason: '맨몸은 무게를 없앤다', fromWeightKg: null },
    ])
  })

  it('무게로 하는 종목에 무게 없이 답하면 버린다(기준 무게가 있을 때)', () => {
    const advice = parseWorkoutAdvice(
      {
        summary: '',
        exercises: [
          { key: 'E1', weightKg: null, reps: 8, reason: '무게가 없다' },
          { key: 'E3', weightKg: 0, reps: 5, reason: '0kg도 없는 것' },
          { key: 'E2', weightKg: null, reps: 12, reason: '맨몸은 괜찮다' },
        ],
      },
      items,
    )
    expect(advice.exercises.map((e) => e.workoutExerciseId)).toEqual(['we-pull'])
  })

  it('쓸 수 있는 답이 없으면 알린다', () => {
    expect(() => parseWorkoutAdvice({ summary: '', exercises: [] }, items)).toThrow(AiError)
    expect(() => parseWorkoutAdvice('nope', items)).toThrow('AI 답의 모양이 달라')
  })

  it('스키마는 받은 key만 허용하고 모든 객체가 닫혀 있다', () => {
    const schema = workoutSchema(['E1', 'E2']) as {
      additionalProperties: boolean
      properties: { exercises: { items: { additionalProperties: boolean; properties: { key: { enum: string[] } } } } }
    }
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.exercises.items.additionalProperties).toBe(false)
    expect(schema.properties.exercises.items.properties.key.enum).toEqual(['E1', 'E2'])
    expect(REVIEW_SCHEMA.additionalProperties).toBe(false)
  })

  it('분석 답은 빈 항목을 빼고 4개까지만 둔다', () => {
    expect(
      parseReview({ headline: ' 꾸준해요 ', good: ['a', '', 'b'], watch: [], suggestions: ['1', '2', '3', '4', '5'] }),
    ).toEqual({ headline: '꾸준해요', good: ['a', 'b'], watch: [], suggestions: ['1', '2', '3', '4'] })
  })
})

describe('AI 추천 받기와 적용', () => {
  it('답을 저장하고, 적용하면 지난번 최고 무게 세트만 바꾼다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    await record(NOW - 3 * DAY, { [BENCH]: [[60, 8], [62.5, 6], [70, 4]] })
    const today = await record(NOW, { [BENCH]: [[60, 8, { done: false }], [62.5, 6, { done: false }], [70, 4, { done: false }]] }, { finish: false })
    askMock.mockResolvedValue({
      value: { summary: '좋아요', exercises: [{ key: 'E1', weightKg: 72.5, reps: 4, reason: '꼭대기 세트만 올려요' }] },
      servedModel: 'claude-opus-5-5',
      costUsd: 0.05,
      inputTokens: 3000,
      outputTokens: 1900,
    })

    await requestWorkoutAdvice(today.id, NOW)
    const req = askMock.mock.calls[0][0]
    expect(req).toMatchObject({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5' })
    expect(req.prompt).toContain('[E1] 벤치프레스')

    const advice = await getWorkoutAdvice(today.id)
    expect(advice).toMatchObject({ summary: '좋아요', meta: { model: 'claude-opus-5-5', costUsd: 0.05 } })
    const suggestion = advice!.exercises[0]
    expect(suggestion).toMatchObject({ workoutExerciseId: today.weIds[BENCH], weightKg: 72.5, reps: 4, fromWeightKg: 70 })
    expect((await getAiUsage()).calls).toBe(1)

    expect(await applyRecommendation(today.weIds[BENCH], suggestion)).toBe(1)
    const sets = await db.sets.where('workoutExerciseId').equals(today.weIds[BENCH]).sortBy('order')
    expect(sets.map((s) => [s.weightKg, s.reps])).toEqual([[60, 8], [62.5, 6], [72.5, 4]])
    expect(isRecommendationApplied(sets, suggestion)).toBe(true)

    // 운동을 취소하면 그 운동의 AI 답도 지운다.
    await deleteWorkout(today.id)
    expect(await getWorkoutAdvice(today.id)).toBeNull()
  })

  it('다시 받은 추천을 적용해도 피라미드의 가벼운 세트는 그대로 둔다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    await record(NOW - 3 * DAY, { [BENCH]: [[50, 10], [55, 8], [60, 6]] })
    const today = await record(NOW, { [BENCH]: [[50, 10, { done: false }], [55, 8, { done: false }], [60, 6, { done: false }]] }, { finish: false })
    const answer = (weightKg: number, reps: number) => ({
      value: { summary: '', exercises: [{ key: 'E1', weightKg, reps, reason: '' }] },
      servedModel: 'claude-opus-5-5',
      costUsd: 0.05,
      inputTokens: 1,
      outputTokens: 1,
    })
    const weights = async () =>
      (await db.sets.where('workoutExerciseId').equals(today.weIds[BENCH]).sortBy('order')).map((s) => [s.weightKg, s.reps])

    askMock.mockResolvedValueOnce(answer(62.5, 6))
    await requestWorkoutAdvice(today.id, NOW)
    await applyRecommendation(today.weIds[BENCH], (await getWorkoutAdvice(today.id))!.exercises[0])
    expect(await weights()).toEqual([[50, 10], [55, 8], [62.5, 6]])

    // 다시 받으면 기준 무게는 지난번 최고(60)가 아니라 지금 남은 세트의 최고(62.5)다.
    askMock.mockResolvedValueOnce(answer(65, 5))
    await requestWorkoutAdvice(today.id, NOW)
    const second = (await getWorkoutAdvice(today.id))!.exercises[0]
    expect(second.fromWeightKg).toBe(62.5)
    await applyRecommendation(today.weIds[BENCH], second)
    expect(await weights()).toEqual([[50, 10], [55, 8], [65, 5]])
  })

  it('applyFromWeight: 규칙의 기준 무게가 남아 있으면 그대로, 없으면 남은 본 세트의 최고 무게', () => {
    const set = (weightKg: number | null, o: { done?: boolean; warmup?: boolean } = {}) => ({
      weightKg,
      isDone: o.done ?? false,
      isWarmup: o.warmup ?? false,
    })
    expect(applyFromWeight([set(60), set(62.5), set(70)], 70, 70)).toBe(70)
    expect(applyFromWeight([set(60), set(72.5)], 70, 72.5)).toBe(72.5)
    expect(applyFromWeight([set(80, { done: true }), set(60), set(20, { warmup: true })], 80, 80)).toBe(60)
    expect(applyFromWeight([set(null), set(null)], 70, 0)).toBe(70)
    expect(applyFromWeight([set(80, { done: true })], null, 80)).toBe(80)
    expect(applyFromWeight([], null, 0)).toBeNull()
  })

  it('같은 운동의 요청이 진행 중이면 한 번만 보내고, 그사이 운동을 지우면 저장하지 않는다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    const today = await record(NOW, { [BENCH]: [[60, 8, { done: false }]] }, { finish: false })
    let resolve!: (v: Awaited<ReturnType<typeof askClaudeJson>>) => void
    askMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))

    const first = requestWorkoutAdvice(today.id, NOW)
    const second = requestWorkoutAdvice(today.id, NOW)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(askMock).toHaveBeenCalledTimes(1))

    await deleteWorkout(today.id)
    resolve({
      value: { summary: '', exercises: [{ key: 'E1', weightKg: 62.5, reps: 8, reason: '' }] },
      servedModel: 'claude-opus-5-5',
      costUsd: 0.05,
      inputTokens: 1,
      outputTokens: 1,
    })
    await first
    expect(await db.aiAdvice.count()).toBe(0)
    expect((await getAiUsage()).calls).toBe(1)
  })

  it('키가 없으면 요청하지 않는다', async () => {
    const today = await record(NOW, { [BENCH]: [[60, 8, { done: false }]] }, { finish: false })
    await expect(requestWorkoutAdvice(today.id, NOW)).rejects.toThrow('API 키를 먼저')
    expect(askMock).not.toHaveBeenCalled()
  })

  it('기록 분석을 받아 하나만 남긴다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    await record(NOW - 10 * DAY, { [SQUAT]: [[100, 5], [100, 5]] }, { memo: '무릎 괜찮음' })
    await record(NOW - 3 * DAY, { [SQUAT]: [[105, 5], [105, 5]] })
    const prompt = await buildReviewContext(NOW)
    expect(prompt).toContain('주별 기록(최근 8주')
    expect(prompt).toContain('스쿼트 (하체) · 최근 8주 2회, 전체 2회')
    expect(prompt).toContain('무릎 괜찮음')

    askMock.mockResolvedValue({
      value: { headline: '꾸준해요', good: ['주 1회 이상'], watch: [], suggestions: ['상체도 해요'] },
      servedModel: 'claude-sonnet-5-5',
      costUsd: 0.02,
      inputTokens: 2000,
      outputTokens: 1000,
    })
    await requestReview(NOW)
    await requestReview(NOW)
    expect(await db.aiAdvice.count()).toBe(1)
    expect(await getReview()).toMatchObject({ headline: '꾸준해요', meta: { model: 'claude-sonnet-5-5' } })
    expect((await getAiUsage()).costUsd).toBeCloseTo(0.04)
  })

  it('기록이 없으면 분석하지 않는다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-test')
    await expect(requestReview(NOW)).rejects.toThrow('분석할 운동 기록이 아직 없습니다')
  })
})

describe('요금', () => {
  it('모델별 토큰 요금으로 어림한다', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 100_000 }
    expect(estimateCostUsd(usage, 'claude-opus-5-5', 'claude-opus-5-5')).toBeCloseTo(6)
    expect(estimateCostUsd(usage, 'claude-sonnet-5-5', 'claude-opus-5-5')).toBeCloseTo(3)
    // 답한 모델을 모르면 요청한 모델의 요금
    expect(estimateCostUsd(usage, 'claude-unknown', 'claude-haiku-5-5')).toBeCloseTo(0.15)
    expect(formatUsd(0.056)).toBe('$0.06')
    expect(formatUsd(0.004)).toBe('$0.01 미만')
  })

  it('다른 모델이 이어 답했으면 시도마다 그 모델의 요금으로 센다', () => {
    const usage = {
      input_tokens: 4000,
      output_tokens: 2000,
      iterations: [
        { type: 'message', input_tokens: 4000, output_tokens: 500, model: 'claude-opus-5-5' },
        { type: 'fallback_message', input_tokens: 4000, output_tokens: 2000, model: 'claude-sonnet-5-5' },
      ],
    }
    expect(costOfUsage(usage, 'claude-sonnet-5-5', 'claude-opus-5-5')).toBeCloseTo(0.026 + 0.028, 6)
    expect(costOfUsage({ input_tokens: 4000, output_tokens: 2000 }, 'claude-opus-5-5', 'claude-opus-5-5')).toBeCloseTo(0.056, 6)
  })

  it('달이 바뀌면 사용량을 새로 센다', async () => {
    const oct = new Date(2026, 9, 31, 12).getTime()
    await addAiUsage(0.1, oct)
    await addAiUsage(0.2, oct)
    expect(await getAiUsage(oct)).toMatchObject({ month: '2026-10', calls: 2 })
    expect(await getAiUsage(NOW)).toEqual({ month: '2026-11', calls: 0, costUsd: 0 })
  })
})

describe('API 키와 백업', () => {
  it('백업 파일에는 키와 사용량이 들어가지 않고, 복원해도 이 폰의 키는 남는다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-ant-mine')
    await setSetting(SETTING_KEYS.aiEnabled, true)
    await addAiUsage(0.1)
    const backup = await exportBackup()
    const keys = backup.data.settings.map((r) => r.key)
    expect(keys).toContain(SETTING_KEYS.aiEnabled)
    expect(keys).not.toContain(SETTING_KEYS.aiApiKey)
    expect(keys).not.toContain(SETTING_KEYS.aiUsage)
    expect(JSON.stringify(backup)).not.toContain('sk-ant-mine')

    // 다른 폰의 키가 실수로 들어 있는 파일이어도 이 폰의 키를 덮어쓰지 않는다.
    backup.data.settings.push({ key: SETTING_KEYS.aiApiKey, value: 'sk-ant-other' })
    await db.aiAdvice.put({
      id: 'review',
      kind: 'review',
      workoutId: null,
      createdAt: 1,
      model: 'claude-opus-5-5',
      costUsd: 0,
      data: { headline: '', good: [], watch: [], suggestions: [] },
    })
    await importBackup(backup)
    expect(await getAiApiKey()).toBe('sk-ant-mine')
    expect(await db.aiAdvice.count()).toBe(0)
  })
})

describe('답 글 꺼내기', () => {
  it('거절로 다른 모델이 이어 답했으면 fallback 블록 뒤의 글만 쓴다', () => {
    expect(answerText([{ type: 'text', text: '{"a":1}' }])).toBe('{"a":1}')
    expect(answerText([{ type: 'thinking' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }])).toBe('{"a":1}')
    expect(
      answerText([{ type: 'text', text: '{"summary":"쓰다 만' }, { type: 'fallback' }, { type: 'text', text: '{"b":2}' }]),
    ).toBe('{"b":2}')
    expect(answerText([])).toBe('')
  })
})

describe('오류 안내', () => {
  it('SDK 오류를 종류별 한국어 안내로 바꾼다', () => {
    const headers = new Headers()
    const auth = toAiError(Anthropic.APIError.generate(401, { error: { message: 'invalid x-api-key' } }, 'bad', headers), Anthropic)
    expect(auth).toMatchObject({ kind: 'auth' })
    expect(auth.message).toContain('API 키가 맞지 않습니다')
    expect(auth.detail).toBe('401 · invalid x-api-key')
    expect(toAiError(Anthropic.APIError.generate(429, {}, 'slow', headers), Anthropic).kind).toBe('rate')
    expect(toAiError(Anthropic.APIError.generate(400, {}, 'credit', headers), Anthropic).kind).toBe('request')
    expect(toAiError(Anthropic.APIError.generate(529, {}, 'overloaded', headers), Anthropic).kind).toBe('server')
    expect(toAiError(new Anthropic.APIConnectionError({ message: 'offline' }), Anthropic).kind).toBe('network')
    expect(toAiError(new Error('?'), Anthropic).kind).toBe('request')
  })
})
