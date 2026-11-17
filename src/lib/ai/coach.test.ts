import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, type AiProfile } from '../../db'
import { exportBackup, importBackup } from '../backup'
import { ensureSeedExercises } from '../exercises'
import { listRoutines } from '../routines'
import { getAiProfile, setSetting, SETTING_KEYS } from '../settings'
import { addExercisesToWorkout, deleteWorkout, finishWorkout, loadWorkoutDetail, startWorkout } from '../workouts'
import {
  FEEDBACK_SCHEMA,
  FEEDBACK_SYSTEM,
  feedbackAdviceId,
  getWorkoutFeedback,
  parseFeedback,
  requestReview,
  requestWorkoutAdvice,
  requestWorkoutFeedback,
  REVIEW_SYSTEM,
  WORKOUT_SYSTEM,
} from './advice'
import { AiError, askClaudeJson } from './client'
import {
  bodyWeightLine,
  buildFeedbackContext,
  buildReviewContext,
  buildRoutineContext,
  buildWorkoutContext,
  describeDoneSets,
  type RoutineCandidate,
} from './context'
import { getAiUsage } from './models'
import { isAiProfileEmpty, profileLines, saveAiProfile } from './profile'
import {
  discardRoutineDraft,
  getRoutineDraft,
  parseRoutineProposals,
  requestRoutineProposals,
  ROUTINE_SYSTEM,
  routineSchema,
  saveRoutineProposals,
} from './routineBuilder'

vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>()
  return { ...real, askClaudeJson: vi.fn() }
})
const askMock = vi.mocked(askClaudeJson)

const BENCH = 'seed:bench-press'
const PULL_UP = 'seed:pull-up'
const SQUAT = 'seed:squat'
const OHP = 'seed:overhead-press'
const PLANK = 'seed:plank'
const DIPS = 'seed:dips'
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date(2026, 10, 16, 19, 0).getTime()
const KEY = 'sk-ant-secret-1234'

type Row = [
  weightKg: number | null,
  reps: number | null,
  opts?: { warmup?: boolean; done?: boolean; rpe?: number; durationSec?: number },
]

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
        ...(o?.rpe === undefined ? {} : { rpe: o.rpe }),
        ...(o?.durationSec === undefined ? {} : { durationSec: o.durationSec }),
      })),
    )
  }
  if (opts.finish ?? true) await finishWorkout(id, { endedAt: startedAt + 3600_000, memo: opts.memo })
  return { id, weIds }
}

const answer = (value: unknown, costUsd = 0.04) => ({
  value,
  servedModel: 'claude-opus-5-5',
  costUsd,
  inputTokens: 3000,
  outputTokens: 1500,
})

const PROFILE: AiProfile = { goal: 'hypertrophy', experience: 'intermediate', daysPerWeek: 4, notes: '왼쪽 어깨가 좋지 않음.\n머리 위로 미는 동작은 피함' }

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
  askMock.mockReset()
})

describe('내 정보', () => {
  it('채운 항목만 글로 만들고, 비어 있으면 아무것도 넣지 않는다', () => {
    expect(profileLines({ goal: null, experience: null, daysPerWeek: null, notes: '  ' })).toEqual([])
    expect(isAiProfileEmpty({ goal: null, experience: null, daysPerWeek: null, notes: ' ' })).toBe(true)
    expect(profileLines(PROFILE)).toEqual([
      '- 목표: 근비대(근육 키우기)',
      '- 운동 경력: 중급',
      '- 주당 운동 목표: 4회',
      '- 참고할 점(부상, 피하고 싶은 동작 등): 왼쪽 어깨가 좋지 않음. 머리 위로 미는 동작은 피함',
    ])
    expect(profileLines({ ...PROFILE, goal: null, notes: '' })).toEqual(['- 운동 경력: 중급', '- 주당 운동 목표: 4회'])
  })

  it('바꾼 항목만 저장하고, 범위를 벗어난 값은 지운다. 백업에도 들어간다', async () => {
    await saveAiProfile({ goal: 'strength', daysPerWeek: 3 })
    await saveAiProfile({ notes: `  ${'가'.repeat(600)}  ` })
    const saved = await getAiProfile()
    expect(saved).toMatchObject({ goal: 'strength', experience: null, daysPerWeek: 3 })
    expect(saved.notes).toHaveLength(500)
    await saveAiProfile({ daysPerWeek: 9, goal: null })
    expect(await getAiProfile()).toMatchObject({ goal: null, daysPerWeek: null })

    await saveAiProfile(PROFILE)
    const backup = await exportBackup()
    expect(backup.data.settings.find((r) => r.key === SETTING_KEYS.aiProfile)?.value).toMatchObject({ goal: 'hypertrophy' })
    await saveAiProfile({ goal: 'health' })
    await importBackup(backup)
    expect((await getAiProfile()).goal).toBe('hypertrophy')
  })

  it('내 정보는 모든 요청 글에 들어가고, 비어 있으면 들어가지 않는다', async () => {
    await record(NOW - 3 * DAY, { [BENCH]: [[60, 8], [60, 8]] })
    const done = await record(NOW - DAY, { [BENCH]: [[62.5, 8], [62.5, 7]] })
    const today = await record(NOW, { [BENCH]: [[62.5, 8, { done: false }]] }, { finish: false })
    const prompts = async () => [
      (await buildWorkoutContext(today.id, NOW)).prompt,
      (await buildReviewContext(NOW))!,
      (await buildFeedbackContext(done.id, NOW))!,
      (await buildRoutineContext('주 3회 전신', NOW)).prompt,
    ]

    for (const p of await prompts()) expect(p).not.toContain('내 정보')

    await saveAiProfile(PROFILE)
    for (const p of await prompts()) {
      expect(p).toContain('내 정보:\n- 목표: 근비대(근육 키우기)\n- 운동 경력: 중급\n- 주당 운동 목표: 4회\n- 참고할 점')
      expect(p).toContain('머리 위로 미는 동작은 피함')
    }
    // 지시문은 내 정보를 어떻게 쓸지 알려 준다.
    for (const system of [WORKOUT_SYSTEM, REVIEW_SYSTEM, FEEDBACK_SYSTEM, ROUTINE_SYSTEM]) expect(system).toContain('내 정보')
  })
})

describe('더 넣는 기록', () => {
  it('세트의 RPE와 시간으로 잰 세트를 글에 담는다', () => {
    const set = (weightKg: number | null, reps: number | null, o: { rpe?: number | null; durationSec?: number; warmup?: boolean } = {}) => ({
      weightKg,
      reps,
      isWarmup: o.warmup ?? false,
      isDone: true,
      rpe: o.rpe,
      durationSec: o.durationSec,
    })
    expect(describeDoneSets([set(40, 10, { warmup: true }), set(60, 8, { rpe: 8 }), set(60, 8, { rpe: 9.5 }), set(60, 7, { rpe: null })])).toBe(
      '웜업 40kg×10 / 60kg×8(RPE 8), 60kg×8(RPE 9.5), 60kg×7',
    )
    expect(describeDoneSets([set(null, 12, { rpe: 7 })])).toBe('12회(RPE 7)')
    expect(describeDoneSets([set(null, null, { durationSec: 45 }), set(10, null, { durationSec: 30, rpe: 9 })])).toBe('45초, 10kg×30초(RPE 9)')
    // 범위를 벗어난 RPE는 적지 않는다.
    expect(describeDoneSets([set(60, 8, { rpe: 0 }), set(60, 8, { rpe: 11 })])).toBe('60kg×8, 60kg×8')
  })

  it('운동 추천 글에 RPE, 종목 메모, 체중이 들어간다', async () => {
    await db.exercises.update(BENCH, { note: '  벤치 3칸,\n 그립은 링에 약지 ' })
    await db.bodyWeights.bulkPut([
      { date: '2026-10-18', weightKg: 73.6, updatedAt: 1 },
      { date: '2026-11-15', weightKg: 72.4, updatedAt: 2 },
    ])
    await record(NOW - 2 * DAY, { [BENCH]: [[60, 8, { rpe: 8 }], [60, 8, { rpe: 9 }]] })
    const today = await record(NOW, { [BENCH]: [[60, 8, { done: true, rpe: 7.5 }], [60, 8, { done: false }]] }, { finish: false })

    const p = (await buildWorkoutContext(today.id, NOW)).prompt
    expect(p).toContain('  종목 메모: 벤치 3칸, 그립은 링에 약지')
    expect(p).toContain('오늘 세트: 60kg×8(RPE 7.5)(완료), 60kg×8')
    expect(p).toContain('- 2026-11-14(토): 60kg×8(RPE 8), 60kg×8(RPE 9) · 추정 1RM 76kg')
    expect(p).toContain('내 정보:\n- 체중: 72.4kg(2026-11-15 기록), 약 4주 전 73.6kg(2026-10-18)에서 -1.2kg')
    expect(WORKOUT_SYSTEM).toContain('RPE')
  })

  it('체중: 가장 최근 기록과 4주 전에 가장 가까운 기록을 견준다', async () => {
    expect(await bodyWeightLine(NOW)).toBeNull()
    await db.bodyWeights.put({ date: '2026-11-10', weightKg: 70, updatedAt: 1 })
    expect(await bodyWeightLine(NOW)).toBe('체중: 70kg(2026-11-10 기록)')

    await db.bodyWeights.bulkPut([
      { date: '2026-08-01', weightKg: 80, updatedAt: 1 }, // 너무 오래됨
      { date: '2026-10-01', weightKg: 68, updatedAt: 1 }, // 40일 전
      { date: '2026-10-15', weightKg: 69.25, updatedAt: 1 }, // 26일 전: 4주에 가장 가깝다
      { date: '2026-11-05', weightKg: 75, updatedAt: 1 }, // 5일 전: 너무 가깝다
      { date: '2026-12-01', weightKg: 90, updatedAt: 1 }, // 오늘보다 뒤의 날짜는 보지 않는다
    ])
    expect(await bodyWeightLine(NOW)).toBe('체중: 70kg(2026-11-10 기록), 약 4주 전 69.25kg(2026-10-15)에서 +0.8kg')

    await db.bodyWeights.put({ date: '2026-10-15', weightKg: 70, updatedAt: 2 })
    expect(await bodyWeightLine(NOW)).toContain('에서 변화 없음')
  })

  it('기록 분석 글에도 종목 메모와 체중이 들어간다', async () => {
    await db.exercises.update(SQUAT, { note: '하이바, 벨트 3번 구멍' })
    await db.bodyWeights.put({ date: '2026-11-16', weightKg: 71, updatedAt: 1 })
    await record(NOW - 3 * DAY, { [SQUAT]: [[100, 5, { rpe: 9 }]] })
    const p = (await buildReviewContext(NOW))!
    expect(p).toContain('  종목 메모: 하이바, 벨트 3번 구멍')
    expect(p).toContain('100kg×5(RPE 9)')
    expect(p).toContain('- 체중: 71kg(2026-11-16 기록)')
  })

  it('시간으로 재는 종목은 운동 추천을 받지 않고 기록만 보여 준다', async () => {
    await record(NOW - 2 * DAY, { [PLANK]: [[null, null, { durationSec: 60 }]], [BENCH]: [[60, 8]] })
    const today = await record(
      NOW,
      { [PLANK]: [[null, null, { durationSec: 60, done: false }]], [BENCH]: [[60, 8, { done: false }]] },
      { finish: false },
    )
    const ctx = await buildWorkoutContext(today.id, NOW)
    expect(ctx.items.map((i) => [i.key, i.workoutExerciseId])).toEqual([['E1', today.weIds[BENCH]]])
    expect(ctx.prompt).toContain('[추천 안 함] 플랭크 (코어, 맨몸 · 시간으로 재는 종목)')
    expect(ctx.prompt).toContain('오늘 세트: 60초')
    // 규칙 추천은 참고하라고 초로 적어 준다.
    expect(ctx.prompt).toContain('앱의 규칙 추천: 65초 (지난번 최고 60초보다 5초 더 버텨 봐요)')
    expect(ctx.prompt).toContain('- 2026-11-14(토): 60초')
    expect(ctx.prompt).toContain('[E1] 벤치프레스')
  })

  it('시간 종목의 목표는 초로 적는다', async () => {
    await db.exercises.update(PLANK, { targetReps: 90 })
    await record(NOW - 2 * DAY, { [PLANK]: [[10, null, { durationSec: 60 }]] })
    const today = await record(NOW, { [PLANK]: [[null, null, { durationSec: 60, done: false }]] }, { finish: false })
    const p = (await buildWorkoutContext(today.id, NOW)).prompt
    expect(p).toContain('[추천 안 함] 플랭크 (코어, 맨몸 · 시간으로 재는 종목 · 목표 90초)')
    expect(p).toContain('- 2026-11-14(토): +10kg×60초')
    expect(p).not.toContain('추정 1RM')
    expect((await buildReviewContext(NOW))!).toContain('플랭크 (코어 · 목표 90초)')
  })

  it('맨몸 종목의 추가 무게는 +로 적고, 추가 무게를 쓰는 종목만 무게 추천을 받는다', async () => {
    await record(NOW - 2 * DAY, { [PULL_UP]: [[10, 5], [10, 5], [null, 8]], [DIPS]: [[null, 12], [null, 10]] })
    const today = await record(
      NOW,
      { [PULL_UP]: [[10, 5, { done: false }], [null, 8, { done: false }]], [DIPS]: [[null, 12, { done: false }]] },
      { finish: false },
    )
    const ctx = await buildWorkoutContext(today.id, NOW)
    const p = ctx.prompt
    expect(p).toContain('[E1] 풀업 (등, 맨몸 · 추가 무게 사용 · 목표 횟수 정하지 않음 · 증량 단위 2.5kg)')
    expect(p).toContain('  오늘 세트: +10kg×5, 8회')
    expect(p).toContain('  앱의 규칙 추천: +12.5kg × 5 (지난번 2세트 모두 5회를 채웠어요)')
    expect(p).toContain('  - 2026-11-14(토): +10kg×5, +10kg×5, 8회')
    // 맨몸으로만 하는 종목은 전과 같다. 추가 무게만으로 낸 추정 1RM은 적지 않는다.
    expect(p).toContain('[E2] 딥스 (가슴, 맨몸 · 목표 횟수 정하지 않음)')
    expect(p).toContain('  앱의 규칙 추천: 13회')
    expect(p).not.toContain('추정 1RM')
    expect(ctx.items).toEqual([
      { key: 'E1', workoutExerciseId: today.weIds[PULL_UP], fromWeightKg: 10, bodyweight: true, addedWeight: true },
      { key: 'E2', workoutExerciseId: today.weIds[DIPS], fromWeightKg: null, bodyweight: true, addedWeight: false },
    ])
    expect(WORKOUT_SYSTEM).toContain('"추가 무게 사용"')
    expect(WORKOUT_SYSTEM).toContain('+10kg×8')
  })

  it('지난 기록에만 추가 무게가 있어도 무게 추천을 받는다', async () => {
    await record(NOW - 9 * DAY, { [PULL_UP]: [[5, 6]] })
    await record(NOW - 2 * DAY, { [PULL_UP]: [[null, 10]] })
    const today = await record(NOW, { [PULL_UP]: [[null, 10, { done: false }]] }, { finish: false })
    const ctx = await buildWorkoutContext(today.id, NOW)
    expect(ctx.items).toMatchObject([{ bodyweight: true, addedWeight: true, fromWeightKg: null }])
    expect(ctx.prompt).toContain('  앱의 규칙 추천: 11회')
  })

  it('피드백 글: 맨몸 종목과 시간 종목의 새 기록을 그 종목의 말로 적는다', async () => {
    await record(NOW - 5 * DAY, { [PULL_UP]: [[10, 5], [null, 8]], [PLANK]: [[null, null, { durationSec: 60 }]] })
    const done = await record(NOW - DAY, { [PULL_UP]: [[12.5, 5], [null, 9]], [PLANK]: [[null, null, { durationSec: 75 }]] })
    const p = (await buildFeedbackContext(done.id, NOW))!
    expect(p).toContain('[1] 풀업 (등, 맨몸 · 추가 무게 사용 · 목표 횟수 정하지 않음 · 증량 단위 2.5kg)')
    expect(p).toContain('  이번 운동: +12.5kg×5, 9회')
    expect(p).toContain('  이번에 세운 새 기록: 최고 추가 무게 +12.5kg(이전 +10kg), 최다 횟수 9회(이전 8회)')
    expect(p).toContain('[2] 플랭크 (코어, 맨몸 · 시간으로 재는 종목)')
    expect(p).toContain('  이번 운동: 75초')
    expect(p).toContain('  이번에 세운 새 기록: 최장 시간 75초(이전 60초)')
    // 시간 세트는 세트 수에는 들어가고 볼륨에는 들어가지 않는다.
    expect(p).toContain('이 운동의 합계: 본 세트 3개, 볼륨 63kg')
  })
})

describe('운동 뒤 피드백', () => {
  it('요청 글: 이번 운동과 같은 종목의 지난 기록, 새 기록을 담는다', async () => {
    await record(NOW - 9 * DAY, { [BENCH]: [[57.5, 8], [57.5, 8]] })
    await record(NOW - 5 * DAY, { [BENCH]: [[60, 8, { rpe: 8 }], [60, 7]], [PULL_UP]: [[null, 8]] })
    const done = await record(NOW - DAY, { [BENCH]: [[40, 10, { warmup: true }], [62.5, 8, { rpe: 9 }], [62.5, 6]], [SQUAT]: [[100, 5]] }, { memo: '잠을 못 잠' })
    // 이 운동보다 나중에 한 기록은 비교에 넣지 않는다.
    await record(NOW, { [BENCH]: [[70, 3]] })

    const p = (await buildFeedbackContext(done.id, NOW))!
    expect(p).toContain('피드백을 받을 운동: 2026-11-15(일), 1시간')
    expect(p).toContain('이 운동의 합계: 본 세트 3개, 볼륨 1,375kg')
    expect(p).toContain('그 전 운동: 2026-11-11(수), 4일 전')
    expect(p).toContain('그 전 4주 운동 횟수: 2회')
    expect(p).toContain('이 운동의 메모: 잠을 못 잠')
    expect(p).toContain('[1] 벤치프레스 (가슴, 바벨 · 목표 횟수 정하지 않음 · 증량 단위 2.5kg)')
    expect(p).toContain('  이번 운동: 웜업 40kg×10 / 62.5kg×8(RPE 9), 62.5kg×6 · 추정 1RM 79.2kg')
    expect(p).toContain('이번에 세운 새 기록: 최고 중량 62.5kg(이전 60kg)')
    expect(p).toContain('  - 2026-11-07(토): 57.5kg×8, 57.5kg×8')
    expect(p).toContain('  - 2026-11-11(수): 60kg×8(RPE 8), 60kg×7')
    expect(p).toContain('[2] 스쿼트')
    expect(p).toContain('지난 기록: 없음(처음 한 종목)')
    expect(p).not.toContain('70kg×3')
    expect(p).not.toContain('풀업')
  })

  it('끝나지 않은 운동이나 없는 운동은 글을 만들지 않는다', async () => {
    const active = await record(NOW, { [BENCH]: [[60, 8]] }, { finish: false })
    expect(await buildFeedbackContext(active.id, NOW)).toBeNull()
    expect(await buildFeedbackContext('none', NOW)).toBeNull()
  })

  it('답 읽기: 빈 항목을 빼고 4개까지, 총평이나 항목이 없으면 알린다', () => {
    expect(parseFeedback({ headline: ' 좋았어요 ', points: ['a', ' ', 'b', 'c', 'd', 'e', 3] })).toEqual({
      headline: '좋았어요',
      points: ['a', 'b', 'c', 'd'],
    })
    expect(() => parseFeedback({ headline: '', points: ['a'] })).toThrow(AiError)
    expect(() => parseFeedback({ headline: '좋았어요', points: [''] })).toThrow('쓸 수 있는 피드백')
    expect(() => parseFeedback({ headline: '좋았어요' })).toThrow('AI 답의 모양이 달라')
    expect(FEEDBACK_SCHEMA.additionalProperties).toBe(false)
  })

  it('받아서 저장하고, 다시 열 때는 저장한 답을 쓰고, 운동을 지우면 같이 지운다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    await record(NOW - 4 * DAY, { [BENCH]: [[60, 8]] })
    const done = await record(NOW - DAY, { [BENCH]: [[62.5, 8]] })
    askMock.mockResolvedValueOnce(answer({ headline: '벤치가 올랐어요.', points: ['62.5kg 8회를 채웠어요.', '다음엔 65kg을 해 봐요.'] }))

    expect(await getWorkoutFeedback(done.id)).toBeNull()
    await requestWorkoutFeedback(done.id, NOW)
    const req = askMock.mock.calls[0][0]
    expect(req).toMatchObject({ apiKey: KEY, model: 'claude-opus-5-5', system: FEEDBACK_SYSTEM, schema: FEEDBACK_SCHEMA })
    expect(req.prompt).toContain('[1] 벤치프레스')

    // 저장한 답은 다시 요청하지 않고 읽는다.
    const saved = await getWorkoutFeedback(done.id)
    expect(saved).toMatchObject({
      headline: '벤치가 올랐어요.',
      points: ['62.5kg 8회를 채웠어요.', '다음엔 65kg을 해 봐요.'],
      meta: { model: 'claude-opus-5-5', costUsd: 0.04 },
    })
    expect(await db.aiAdvice.get(feedbackAdviceId(done.id))).toMatchObject({ kind: 'feedback', workoutId: done.id })
    expect(askMock).toHaveBeenCalledTimes(1)
    expect(await getAiUsage()).toMatchObject({ calls: 1, costUsd: 0.04 })

    // 다시 받으면 새 답으로 바뀐다.
    askMock.mockResolvedValueOnce(answer({ headline: '두 번째 답', points: ['a', 'b'] }))
    await requestWorkoutFeedback(done.id, NOW)
    expect((await getWorkoutFeedback(done.id))?.headline).toBe('두 번째 답')
    expect(await db.aiAdvice.count()).toBe(1)

    await deleteWorkout(done.id)
    expect(await getWorkoutFeedback(done.id)).toBeNull()
    expect(await db.aiAdvice.count()).toBe(0)
  })

  it('진행 중이면 한 번만 보내고, 그사이 운동을 지우면 저장하지 않는다. 읽지 못한 답도 요금은 센다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    const done = await record(NOW - DAY, { [BENCH]: [[62.5, 8]] })
    let resolve!: (v: Awaited<ReturnType<typeof askClaudeJson>>) => void
    askMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const first = requestWorkoutFeedback(done.id, NOW)
    expect(requestWorkoutFeedback(done.id, NOW)).toBe(first)
    await vi.waitFor(() => expect(askMock).toHaveBeenCalledTimes(1))
    await deleteWorkout(done.id)
    resolve(answer({ headline: '좋아요', points: ['a', 'b'] }))
    await first
    expect(await db.aiAdvice.count()).toBe(0)

    const other = await record(NOW - 2 * DAY, { [BENCH]: [[60, 8]] })
    askMock.mockResolvedValueOnce(answer({ headline: '', points: [] }))
    await expect(requestWorkoutFeedback(other.id, NOW)).rejects.toThrow('쓸 수 있는 피드백')
    expect(await getWorkoutFeedback(other.id)).toBeNull()
    expect((await getAiUsage()).calls).toBe(2)
  })

  it('키가 없거나 끝낸 운동이 아니면 요청하지 않는다', async () => {
    const done = await record(NOW - DAY, { [BENCH]: [[62.5, 8]] })
    await expect(requestWorkoutFeedback(done.id, NOW)).rejects.toThrow('API 키를 먼저')
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    const active = await record(NOW, { [BENCH]: [[60, 8]] }, { finish: false })
    await expect(requestWorkoutFeedback(active.id, NOW)).rejects.toThrow('끝낸 운동의 기록')
    expect(askMock).not.toHaveBeenCalled()
  })
})

describe('AI 루틴 만들기', () => {
  const candidates: RoutineCandidate[] = [
    { key: 'E1', exerciseId: BENCH, timed: false },
    { key: 'E2', exerciseId: SQUAT, timed: false },
    { key: 'E3', exerciseId: PULL_UP, timed: false },
    { key: 'E4', exerciseId: PLANK, timed: true },
  ]

  it('요청 글: 요청, 최근 훈련 요약, 고를 수 있는 종목을 담고 숨긴 종목은 뺀다', async () => {
    await db.exercises.update(OHP, { archived: true })
    await db.exercises.update(SQUAT, { note: '하이바' })
    await record(NOW - 10 * DAY, { [SQUAT]: [[100, 5], [100, 5]], [OHP]: [[40, 8]] })
    await record(NOW - 3 * DAY, { [SQUAT]: [[60, 8, { warmup: true }], [105, 5, { rpe: 9 }], [105, 4]] })
    await db.routines.add({ id: 'r1', name: '하체 날', items: [{ exerciseId: SQUAT, sets: 4, reps: 5 }], createdAt: 1, updatedAt: 1, lastUsedAt: null })

    const ctx = await buildRoutineContext('  주 3회\n상체/하체 분할  ', NOW)
    const p = ctx.prompt
    expect(p).toContain('최근 4주 운동 횟수: 2회')
    expect(p).toContain('최근 4주 부위별 본 세트 수: ')
    expect(p).toContain('이미 저장한 루틴:\n- 하체 날: 스쿼트 4세트×5회')
    expect(p.endsWith('요청: 주 3회 상체/하체 분할')).toBe(true)

    const squat = ctx.candidates.find((c) => c.exerciseId === SQUAT)!
    expect(p).toContain(`${squat.key} 스쿼트 (하체, 바벨) · 최근 8주 2회, 마지막 105kg×5(RPE 9), 105kg×4 · 메모: 하이바`)
    const plank = ctx.candidates.find((c) => c.exerciseId === PLANK)!
    expect(plank.timed).toBe(true)
    expect(p).toContain(`${plank.key} 플랭크 (코어, 맨몸) · 시간으로 재는 종목`)
    // 숨긴 종목은 고를 수 없다.
    expect(ctx.candidates.some((c) => c.exerciseId === OHP)).toBe(false)
    expect(p).not.toContain('오버헤드 프레스 (어깨, 바벨)')
    // key는 E1부터 차례대로, 종목마다 하나씩이다.
    expect(ctx.candidates.map((c) => c.key)).toEqual(ctx.candidates.map((_, i) => `E${i + 1}`))
    expect(ctx.candidates).toHaveLength((await db.exercises.count()) - 1)
  })

  it('기록이 없어도 요청 글을 만든다', async () => {
    const ctx = await buildRoutineContext('초보 전신 루틴', NOW)
    expect(ctx.prompt).toContain('운동 기록: 아직 없음')
    expect(ctx.candidates.length).toBeGreaterThan(50)
  })

  it('답 읽기: 모르는 key, 범위를 벗어난 세트와 횟수, 겹친 종목, 빈 루틴을 버린다', () => {
    const routines = parseRoutineProposals(
      {
        routines: [
          {
            name: '  상체   A ',
            rationale: ' 밀기와 당기기를 섞었어요. ',
            items: [
              { key: 'E1', sets: 4, reps: 8 },
              { key: 'E1', sets: 3, reps: 10 }, // 같은 종목 두 번째
              { key: 'E9', sets: 3, reps: 10 }, // 모르는 key
              { key: 'E3', sets: 3, reps: null },
              { key: 'E4', sets: 3, reps: 30 }, // 시간으로 재는 종목은 횟수를 두지 않는다
            ],
          },
          {
            name: '',
            rationale: '',
            items: [
              { key: 'E2', sets: 0, reps: 5 },
              { key: 'E2', sets: 11, reps: 5 },
              { key: 'E2', sets: 3.5, reps: 5 },
              { key: 'E2', sets: 5, reps: 5 },
              { key: 'E3', sets: 3, reps: 0 },
              { key: 'E3', sets: 3, reps: 51 },
              { key: 'E1', sets: '3', reps: 8 },
              { key: 'E1', sets: 10, reps: 50 },
            ],
          },
          { name: '빈 루틴', rationale: '', items: [{ key: 'E7', sets: 3, reps: 10 }] },
          { name: '모양이 다름', rationale: '' },
          'nope',
        ],
      },
      candidates,
    )
    expect(routines.map((r) => ({ name: r.name, rationale: r.rationale, items: r.items }))).toEqual([
      {
        name: '상체 A',
        rationale: '밀기와 당기기를 섞었어요.',
        items: [
          { exerciseId: BENCH, sets: 4, reps: 8 },
          { exerciseId: PULL_UP, sets: 3, reps: null },
          { exerciseId: PLANK, sets: 3, reps: null },
        ],
      },
      {
        name: 'AI 루틴 2',
        rationale: '',
        items: [
          { exerciseId: SQUAT, sets: 5, reps: 5 },
          { exerciseId: BENCH, sets: 10, reps: 50 },
        ],
      },
    ])
    expect(new Set(routines.map((r) => r.id)).size).toBe(2)
  })

  it('답 읽기: 루틴은 4개까지, 이름은 30자까지, 쓸 수 있는 루틴이 없으면 알린다', () => {
    const one = (name: string) => ({ name, rationale: '', items: [{ key: 'E1', sets: 3, reps: 10 }] })
    const routines = parseRoutineProposals({ routines: ['가'.repeat(40), 'b', 'c', 'd', 'e'].map(one) }, candidates)
    expect(routines.map((r) => r.name)).toEqual(['가'.repeat(30), 'b', 'c', 'd'])
    expect(() => parseRoutineProposals({ routines: [] }, candidates)).toThrow('루틴을 제안하지 못했습니다')
    expect(() => parseRoutineProposals({ routines: [{ name: 'x', rationale: '', items: [] }] }, candidates)).toThrow(AiError)
    expect(() => parseRoutineProposals({}, candidates)).toThrow('AI 답의 모양이 달라')
  })

  it('스키마는 받은 key만 허용하고 모든 객체가 닫혀 있으며 범위 키워드를 쓰지 않는다', () => {
    const schema = routineSchema(['E1', 'E2'])
    const text = JSON.stringify(schema)
    expect(text).toContain('"enum":["E1","E2"]')
    expect(text.match(/"type":"object"/g)).toHaveLength(3)
    expect(text.match(/"additionalProperties":false/g)).toHaveLength(3)
    expect(text).not.toMatch(/minimum|maximum|minItems|maxItems|minLength|maxLength/)
  })

  it('제안을 받아도 루틴은 만들어지지 않고, 고른 것만 보통 루틴으로 저장된다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    await saveAiProfile(PROFILE)
    await record(NOW - 3 * DAY, { [SQUAT]: [[105, 5]] })
    askMock.mockImplementationOnce(async (req) => {
      const key = (id: string, name: string) => {
        const line = req.prompt.split('\n').find((l) => new RegExp(`^E\\d+ ${name} \\(`).test(l))
        expect(line, id).toBeDefined()
        return line!.split(' ')[0]
      }
      return answer(
        {
          routines: [
            { name: '상체', rationale: '어깨 부담을 줄였어요.', items: [{ key: key(BENCH, '벤치프레스'), sets: 4, reps: 8 }, { key: key(PULL_UP, '풀업'), sets: 3, reps: 8 }] },
            { name: '하체', rationale: '스쿼트를 이어 가요.', items: [{ key: key(SQUAT, '스쿼트'), sets: 5, reps: 5 }] },
            { name: '전신', rationale: '', items: [{ key: key(SQUAT, '스쿼트'), sets: 3, reps: 8 }] },
          ],
        },
        0.07,
      )
    })

    const draft = await requestRoutineProposals('  주 2회\n상체/하체  ', NOW)
    expect(draft.request).toBe('주 2회 상체/하체')
    const req = askMock.mock.calls[0][0]
    expect(req).toMatchObject({ apiKey: KEY, model: 'claude-opus-5-5', system: ROUTINE_SYSTEM })
    expect(req.prompt).toContain('요청: 주 2회 상체/하체')
    expect(req.prompt).toContain('- 목표: 근비대(근육 키우기)')
    expect(JSON.stringify(req.schema)).toContain('"enum":["E1","E2"')

    // 미리 보기만 있고 루틴은 아직 없다. 요금은 센다.
    expect(await listRoutines()).toEqual([])
    expect(await getAiUsage()).toMatchObject({ calls: 1, costUsd: 0.07 })
    const view = (await getRoutineDraft())!
    expect(view.request).toBe('주 2회 상체/하체')
    expect(view.meta).toMatchObject({ model: 'claude-opus-5-5', costUsd: 0.07 })
    expect(view.proposals.map((p) => [p.name, p.entries.map((e) => `${e.name} ${e.item.sets}×${e.item.reps}`)])).toEqual([
      ['상체', ['벤치프레스 4×8', '풀업 3×8']],
      ['하체', ['스쿼트 5×5']],
      ['전신', ['스쿼트 3×8']],
    ])

    // 고른 두 개만 저장되고, 제안 순서대로 목록에 보인다. 저장한 것은 제안에서 빠진다.
    const [upper, lower, full] = view.proposals
    const ids = await saveRoutineProposals([lower.id, upper.id], NOW)
    expect(ids).toHaveLength(2)
    const saved = await listRoutines()
    expect(saved.map((r) => r.name)).toEqual(['상체', '하체'])
    expect(saved[0]).toMatchObject({ id: ids[0], lastUsedAt: null, items: [{ exerciseId: BENCH, sets: 4, reps: 8 }, { exerciseId: PULL_UP, sets: 3, reps: 8 }] })
    expect((await getRoutineDraft())!.proposals.map((p) => p.id)).toEqual([full.id])

    // 같은 것을 다시 저장하려 해도 두 번 만들어지지 않는다.
    expect(await saveRoutineProposals([upper.id], NOW)).toEqual([])
    expect(await db.routines.count()).toBe(2)

    // 남은 것까지 저장하면 제안이 지워진다.
    await saveRoutineProposals([full.id], NOW + 1000)
    expect(await getRoutineDraft()).toBeNull()
    expect(await db.aiAdvice.count()).toBe(0)
    expect((await listRoutines()).map((r) => r.name)).toEqual(['전신', '상체', '하체'])
    expect(askMock).toHaveBeenCalledTimes(1)
  })

  it('다시 받으면 제안이 바뀌고, 지울 수 있고, 그사이 지워진 종목은 빼고 보여 주고 저장한다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    const ctx = await buildRoutineContext('x', NOW)
    const keyOf = (id: string) => ctx.candidates.find((c) => c.exerciseId === id)!.key
    const reply = (name: string) =>
      answer({
        routines: [
          { name, rationale: '', items: [{ key: keyOf(BENCH), sets: 3, reps: 10 }, { key: keyOf(SQUAT), sets: 3, reps: 10 }] },
          { name: '풀업만', rationale: '', items: [{ key: keyOf(PULL_UP), sets: 3, reps: null }] },
        ],
      })
    askMock.mockResolvedValueOnce(reply('첫 제안'))
    await requestRoutineProposals('전신', NOW)
    askMock.mockResolvedValueOnce(reply('둘째 제안'))
    await requestRoutineProposals('전신 다시', NOW)
    expect(await db.aiAdvice.count()).toBe(1)
    expect((await getRoutineDraft())!.proposals.map((p) => p.name)).toEqual(['둘째 제안', '풀업만'])

    await db.exercises.delete(BENCH)
    await db.exercises.delete(PULL_UP)
    const view = (await getRoutineDraft())!
    expect(view.proposals.map((p) => [p.name, p.entries.map((e) => e.name)])).toEqual([['둘째 제안', ['스쿼트']]])
    // 종목이 모두 지워진 제안은 골라도 저장되지 않는다.
    const all = (await db.table('aiAdvice').get('routines')).data.routines.map((r: { id: string }) => r.id)
    expect(await saveRoutineProposals(all, NOW)).toHaveLength(1)
    expect((await listRoutines())[0].items).toEqual([{ exerciseId: SQUAT, sets: 3, reps: 10 }])

    askMock.mockResolvedValueOnce(answer({ routines: [{ name: '하체', rationale: '', items: [{ key: keyOf(SQUAT), sets: 3, reps: 10 }] }] }))
    await requestRoutineProposals('하체', NOW)
    await discardRoutineDraft()
    expect(await getRoutineDraft()).toBeNull()
    expect(await db.routines.count()).toBe(1)
  })

  it('제안을 받은 뒤 숨긴 종목은 빼고, 시간으로 재게 바꾼 종목은 횟수 목표를 비워 저장한다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    const ctx = await buildRoutineContext('x', NOW)
    const keyOf = (id: string) => ctx.candidates.find((c) => c.exerciseId === id)!.key
    askMock.mockResolvedValueOnce(
      answer({
        routines: [
          {
            name: '전신',
            rationale: '',
            items: [{ key: keyOf(BENCH), sets: 3, reps: 10 }, { key: keyOf(SQUAT), sets: 3, reps: 30 }, { key: keyOf(OHP), sets: 3, reps: 8 }],
          },
        ],
      }),
    )
    await requestRoutineProposals('전신', NOW)
    await db.exercises.update(OHP, { archived: true })
    await db.exercises.update(SQUAT, { measure: 'time' })

    const view = (await getRoutineDraft())!
    expect(view.proposals[0].entries.map((e) => [e.name, e.item.reps])).toEqual([['벤치프레스', 10], ['스쿼트', null]])
    await saveRoutineProposals([view.proposals[0].id], NOW)
    expect((await listRoutines())[0].items).toEqual([
      { exerciseId: BENCH, sets: 3, reps: 10 },
      { exerciseId: SQUAT, sets: 3, reps: null },
    ])
  })

  it('쓸 수 없는 답이면 전에 받은 제안은 그대로 두고 알린다. 요청이 비었거나 키가 없으면 보내지 않는다', async () => {
    await expect(requestRoutineProposals('상체', NOW)).rejects.toThrow('API 키를 먼저')
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    await expect(requestRoutineProposals('   ', NOW)).rejects.toThrow('어떤 루틴을 원하는지')
    expect(askMock).not.toHaveBeenCalled()

    askMock.mockResolvedValueOnce(answer({ routines: [{ name: '상체', rationale: '', items: [{ key: 'E1', sets: 3, reps: 10 }] }] }))
    await requestRoutineProposals('상체', NOW)
    askMock.mockResolvedValueOnce(answer({ routines: [] }))
    await expect(requestRoutineProposals('오늘 날씨 어때', NOW)).rejects.toThrow('루틴을 제안하지 못했습니다')
    expect((await getRoutineDraft())!.request).toBe('상체')
    expect((await getAiUsage()).calls).toBe(2)
  })

  it('진행 중인 요청은 한 번만 보낸다. 제안은 백업에 들어가지 않고 복원하면 지워진다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    let resolve!: (v: Awaited<ReturnType<typeof askClaudeJson>>) => void
    askMock.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    const first = requestRoutineProposals('상체', NOW)
    expect(requestRoutineProposals('하체', NOW)).toBe(first)
    await vi.waitFor(() => expect(askMock).toHaveBeenCalledTimes(1))
    resolve(answer({ routines: [{ name: '상체', rationale: '', items: [{ key: 'E1', sets: 3, reps: 10 }] }] }))
    await first
    expect(askMock).toHaveBeenCalledTimes(1)

    const backup = await exportBackup()
    expect(JSON.stringify(backup)).not.toContain('"routines":[{"id"')
    expect(backup.data.routines).toEqual([])
    await importBackup(backup)
    expect(await getRoutineDraft()).toBeNull()
  })
})

describe('API 키', () => {
  it('어떤 요청의 글이나 지시문, 스키마에도 키가 들어가지 않는다', async () => {
    await setSetting(SETTING_KEYS.aiApiKey, KEY)
    await saveAiProfile(PROFILE)
    await db.bodyWeights.put({ date: '2026-11-15', weightKg: 72, updatedAt: 1 })
    await db.exercises.update(BENCH, { note: '그립 넓게' })
    await record(NOW - 4 * DAY, { [BENCH]: [[60, 8, { rpe: 8 }]] }, { memo: '컨디션 좋음' })
    const done = await record(NOW - DAY, { [BENCH]: [[62.5, 8]] })
    const today = await record(NOW, { [BENCH]: [[62.5, 8, { done: false }]] }, { finish: false })

    askMock.mockResolvedValueOnce(answer({ summary: '', exercises: [{ key: 'E1', weightKg: 65, reps: 8, reason: '' }] }))
    await requestWorkoutAdvice(today.id, NOW)
    askMock.mockResolvedValueOnce(answer({ headline: '좋아요', good: [], watch: [], suggestions: [] }))
    await requestReview(NOW)
    askMock.mockResolvedValueOnce(answer({ headline: '좋아요', points: ['a', 'b'] }))
    await requestWorkoutFeedback(done.id, NOW)
    askMock.mockResolvedValueOnce(answer({ routines: [{ name: '상체', rationale: '', items: [{ key: 'E1', sets: 3, reps: 10 }] }] }))
    await requestRoutineProposals('상체 루틴', NOW)

    expect(askMock).toHaveBeenCalledTimes(4)
    for (const [req] of askMock.mock.calls) {
      expect(req.apiKey).toBe(KEY)
      const sent = JSON.stringify({ system: req.system, prompt: req.prompt, schema: req.schema })
      expect(sent).not.toContain('sk-ant')
      expect(sent).not.toContain(KEY)
      // 내 정보와 체중은 네 요청 모두에 들어간다.
      expect(req.prompt).toContain('- 목표: 근비대(근육 키우기)')
      expect(req.prompt).toContain('- 체중: 72kg(2026-11-15 기록)')
    }
    // 저장한 답과 제안에도 키는 없다.
    expect(JSON.stringify(await db.aiAdvice.toArray())).not.toContain('sk-ant')
  })
})
