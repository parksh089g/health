import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../db'
import { bodyFatPercent, compositionError, formatComposition, saveBodyWeight } from '../bodyWeight'
import { ensureSeedExercises } from '../exercises'
import { setSetting, SETTING_KEYS } from '../settings'
import { addExercisesToWorkout, finishWorkout, loadWorkoutDetail, startWorkout } from '../workouts'
import { askChat, chatCostEstimate, chatIntro, chatRoundCost, cleanAnswer, getChatState, resetChat, runConversation } from './chat'
import { CHAT_TOOLS, loadChatData, runChatTool } from './chatTools'
import { createClient } from './client'
import { getAiUsage } from './models'

vi.mock('./client', async (importOriginal) => {
  const real = await importOriginal<typeof import('./client')>()
  return { ...real, createClient: vi.fn() }
})
const createClientMock = vi.mocked(createClient)

const BENCH = 'seed:bench-press'
const SQUAT = 'seed:squat'
const DAY = 24 * 60 * 60 * 1000
/** 2026년 11월 24일 오후 7시(로컬 시간) */
const NOW = new Date(2026, 10, 24, 19, 0).getTime()

async function record(startedAt: number, rowsByExercise: Record<string, [number | null, number | null][]>) {
  const id = await startWorkout(startedAt)
  await addExercisesToWorkout(id, Object.keys(rowsByExercise))
  const detail = await loadWorkoutDetail(id)
  for (const [exerciseId, rows] of Object.entries(rowsByExercise)) {
    const weId = detail!.items.find((i) => i.we.exerciseId === exerciseId)!.we.id
    await db.sets.where('workoutExerciseId').equals(weId).delete()
    await db.sets.bulkAdd(
      rows.map(([weightKg, reps], i) => ({
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
  return id
}

const ctx = async () => ({ data: await loadChatData(), now: NOW })

beforeEach(async () => {
  await db.delete()
  await db.open()
  await ensureSeedExercises()
  createClientMock.mockReset()
  resetChat()
})

describe('체성분', () => {
  it('체지방률은 체지방량을 체중으로 나눈다', () => {
    expect(bodyFatPercent({ weightKg: 72.4, bodyFatKg: 14.2 })).toBe(19.6)
    expect(bodyFatPercent({ weightKg: 72.4, bodyFatKg: null })).toBeNull()
    expect(formatComposition({ weightKg: 72.4, muscleKg: 32.1, bodyFatKg: 14.2 })).toBe('골격근 32.1kg · 체지방 14.2kg(19.6%)')
    expect(formatComposition({ weightKg: 72.4 })).toBe('')
  })

  it('범위와 체중을 넘는 값은 받지 않는다', () => {
    expect(compositionError(72, { muscleKg: null, bodyFatKg: null })).toBeNull()
    expect(compositionError(72, { muscleKg: 32.1, bodyFatKg: 14 })).toBeNull()
    expect(compositionError(72, { muscleKg: 3, bodyFatKg: null })).toMatch('골격근량은 5~150kg')
    expect(compositionError(72, { muscleKg: 32.15, bodyFatKg: null })).toMatch('소수 첫째 자리')
    expect(compositionError(72, { muscleKg: null, bodyFatKg: 80 })).toMatch('체지방량은 체중보다 작아야')
    expect(compositionError(72, { muscleKg: 40, bodyFatKg: 35 })).toMatch('더한 값이 체중보다 작아야')
  })

  it('체성분을 함께 저장하고, 체중만 고치면 그날 체성분은 그대로 둔다', async () => {
    await saveBodyWeight('2026-11-20', 72.4, NOW, { muscleKg: 32.1, bodyFatKg: 14.2 })
    await saveBodyWeight('2026-11-20', 72.0, NOW)
    expect(await db.bodyWeights.get('2026-11-20')).toMatchObject({ weightKg: 72, muscleKg: 32.1, bodyFatKg: 14.2 })
    await saveBodyWeight('2026-11-20', 72.0, NOW, { muscleKg: null, bodyFatKg: 13.9 })
    const row = await db.bodyWeights.get('2026-11-20')
    expect(row?.muscleKg).toBeUndefined()
    expect(row?.bodyFatKg).toBe(13.9)
    await expect(saveBodyWeight('2026-11-20', 72, NOW, { muscleKg: 80, bodyFatKg: null })).rejects.toThrow('골격근량은')
  })
})

describe('기록 도구', () => {
  it('도구 정의는 strict 스키마를 지킨다', () => {
    for (const t of CHAT_TOOLS) {
      const schema = t.input_schema as unknown as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean }
      expect(t.strict).toBe(true)
      expect(schema.additionalProperties).toBe(false)
      expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort())
    }
  })

  it('지난달 벤치 최고 무게를 기간 안과 전체로 나눠 준다', async () => {
    await record(new Date(2026, 9, 5, 19).getTime(), { [BENCH]: [[70, 8], [72.5, 6]] })
    await record(new Date(2026, 9, 20, 19).getTime(), { [BENCH]: [[75, 5], [70, 8]] })
    await record(new Date(2026, 10, 10, 19).getTime(), { [BENCH]: [[80, 3]] })
    const out = await runChatTool('get_exercise_bests', { exercise: '벤치프레스', from: '2026-10-01', to: '2026-10-31' }, await ctx())
    expect(out.isError).toBe(false)
    expect(out.text).toContain('2026-10-01 ~ 2026-10-31 (기록 2회)')
    expect(out.text).toMatch(/최고 중량: 75kg \(2026-10-20\(화\) · 75×5\)/)
    expect(out.text).toContain('전체 기간 (기록 3회)')
    expect(out.text).toMatch(/최고 중량: 80kg/)
  })

  it('애매한 이름은 기록이 있는 하나로 고르고, 여럿이면 후보를 알려 준다', async () => {
    await record(NOW - 3 * DAY, { [BENCH]: [[60, 10]] })
    const one = await runChatTool('get_exercise_history', { exercise: '벤치', from: null, to: null, limit: null }, await ctx())
    expect(one.isError).toBe(false)
    expect(one.text).toContain('벤치프레스 (가슴, 바벨)')
    expect(one.text).toContain('60kg×10')

    const none = await runChatTool('get_exercise_history', { exercise: '없는종목', from: null, to: null, limit: null }, await ctx())
    expect(none).toMatchObject({ isError: true })
    expect(none.text).toContain('find_exercises')

    const bad = await runChatTool('get_exercise_bests', { exercise: '벤치프레스', from: '지난달', to: null }, await ctx())
    expect(bad).toMatchObject({ isError: true })
    expect(bad.text).toContain('YYYY-MM-DD')
  })

  it('체성분 기록과 기간 안의 변화를 준다', async () => {
    await saveBodyWeight('2026-10-01', 75, NOW, { muscleKg: 31.5, bodyFatKg: 17 })
    await saveBodyWeight('2026-10-15', 74.2, NOW)
    await saveBodyWeight('2026-11-20', 72.4, NOW, { muscleKg: 32.1, bodyFatKg: 14.2 })
    const out = await runChatTool('get_body_composition', { from: null, to: null }, await ctx())
    expect(out.text).toContain('- 2026-11-20: 체중 72.4kg · 골격근 32.1kg · 체지방 14.2kg(19.6%)')
    expect(out.text).toContain('- 2026-10-15: 체중 74.2kg\n')
    expect(out.text).toContain('- 골격근량: 31.5kg(2026-10-01) → 32.1kg(2026-11-20), +0.6kg')
    expect(out.text).toContain('- 체지방량: 17kg(2026-10-01) → 14.2kg(2026-11-20), -2.8kg')
  })

  it('운동 목록과 주별 요약을 준다', async () => {
    await record(NOW - 2 * DAY, { [BENCH]: [[60, 10], [65, 8]], [SQUAT]: [[100, 5]] })
    const list = await runChatTool('list_workouts', { from: '2026-11-01', to: null }, await ctx())
    expect(list.text).toContain('끝낸 운동 1회')
    expect(list.text).toMatch(/벤치프레스 2세트\(65×8\), 스쿼트 1세트\(100×5\)/)
    const summary = await runChatTool('get_training_summary', { weeks: 2 }, await ctx())
    expect(summary.text).toContain('본 세트 3개, 볼륨 1,620kg')
    expect(summary.text).toContain('최근 4주 가슴 2')
  })
})

describe('대화', () => {
  it('첫 질문에는 오늘 날짜와 내 정보, 체성분을 붙인다', async () => {
    await setSetting(SETTING_KEYS.aiProfile, { goal: 'fat-loss', experience: 'beginner', daysPerWeek: 3, notes: '' })
    await saveBodyWeight('2026-11-20', 72.4, NOW, { muscleKg: 32.1, bodyFatKg: 14.2 })
    const intro = await chatIntro(NOW)
    expect(intro).toContain('오늘: 2026-11-24(화)')
    expect(intro).toContain('목표: 체지방 감량')
    expect(intro).toContain('체성분(2026-11-20 측정): 골격근 32.1kg · 체지방 14.2kg(19.6%)')
  })

  it('요금은 캐시 읽기와 쓰기를 따로 센다', () => {
    const plain = chatRoundCost({ input_tokens: 1000, output_tokens: 100 }, 'claude-opus-5-5', 'claude-opus-5-5')
    expect(plain).toBeCloseTo((1000 * 4 + 100 * 20) / 1e6)
    const cached = chatRoundCost(
      { input_tokens: 1000, output_tokens: 100, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000 },
      'claude-opus-5-5',
      'claude-opus-5-5',
    )
    expect(cached).toBeCloseTo(((1000 + 2500 + 1000) * 4 + 100 * 20) / 1e6)
    expect(chatCostEstimate('claude-opus-5-5', 0)).toBeCloseTo(0.072)
    expect(chatCostEstimate('claude-opus-5-5', 4000)).toBeGreaterThan(chatCostEstimate('claude-opus-5-5', 0))
  })

  it('굵은 글씨와 제목 기호를 뺀다', () => {
    expect(cleanAnswer('## 계획\n\n**월요일**: 스쿼트\n\n\n\n끝')).toBe('계획\n\n월요일: 스쿼트\n\n끝')
  })

  it('도구를 불러 기록을 보고 답한다', async () => {
    await record(new Date(2026, 9, 20, 19).getTime(), { [BENCH]: [[75, 5]] })
    const requests: { messages: unknown[]; tool_choice?: unknown }[] = []
    const replies = [
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'get_exercise_bests',
            input: { exercise: '벤치프레스', from: '2026-10-01', to: '2026-10-31' },
          },
        ],
        usage: { input_tokens: 3000, output_tokens: 200, cache_creation_input_tokens: 2500, cache_read_input_tokens: 0 },
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '지난달 벤치프레스 최고 무게는 **75kg**(10월 20일, 5회)이에요.' }],
        usage: { input_tokens: 400, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 5500 },
      },
    ]
    createClientMock.mockResolvedValue({
      Anthropic: (await import('@anthropic-ai/sdk')).default,
      client: {
        beta: {
          messages: {
            stream: (params: { messages: unknown[]; tool_choice?: unknown }) => {
              requests.push({ ...params, messages: structuredClone(params.messages) })
              const r = replies.shift()!
              return { finalMessage: async () => ({ model: 'claude-opus-5-5', stop_details: null, ...r }) }
            },
          },
        },
      },
    } as never)
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-test')

    await askChat('지난달 벤치 최고 무게가 얼마였지?', NOW)
    const s = getChatState()
    expect(s.error).toBeNull()
    expect(s.turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(s.turns[1].text).toBe('지난달 벤치프레스 최고 무게는 75kg(10월 20일, 5회)이에요.')
    expect(s.turns[1].looked).toEqual(['벤치프레스 최고 기록'])
    // 두 번째 요청에는 생각 블록과 도구 호출을 그대로 돌려보내고, 그 뒤에 도구 결과를 붙인다.
    const second = requests[1].messages as { role: string; content: unknown }[]
    expect(second).toHaveLength(3)
    expect(String(second[0].content)).toContain('질문: 지난달 벤치 최고 무게가 얼마였지?')
    expect((second[1].content as { type: string }[]).map((b) => b.type)).toEqual(['thinking', 'tool_use'])
    const result = (second[2].content as { type: string; content: string; tool_use_id: string }[])[0]
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    expect(result.content).toContain('최고 중량: 75kg')
    // 사용량에는 질문 한 번으로 센다.
    const usage = await getAiUsage()
    expect(usage.calls).toBe(1)
    expect(usage.costUsd).toBeCloseTo(s.turns[1].costUsd!)
    expect(s.historyTokens).toBe(400 + 5500 + 150)
  })

  it('실패하면 대화를 질문 전으로 되돌리고 질문을 남긴다', async () => {
    createClientMock.mockResolvedValue({
      Anthropic: (await import('@anthropic-ai/sdk')).default,
      client: {
        beta: {
          messages: {
            stream: () => ({
              finalMessage: async () => ({
                model: 'claude-opus-5-5',
                stop_reason: 'refusal',
                stop_details: { explanation: 'no' },
                content: [],
                usage: { input_tokens: 100, output_tokens: 0 },
              }),
            }),
          },
        },
      },
    } as never)
    await setSetting(SETTING_KEYS.aiApiKey, 'sk-test')
    await askChat('질문', NOW)
    const s = getChatState()
    expect(s.turns).toEqual([])
    expect(s.messages).toEqual([])
    expect(s.failedQuestion).toBe('질문')
    expect(s.error?.kind).toBe('refusal')
    expect((await getAiUsage()).calls).toBe(1)
  })

  it('계속 도구만 부르면 마지막 번에는 도구 없이 답하게 한다', async () => {
    const choices: unknown[] = []
    createClientMock.mockResolvedValue({
      Anthropic: (await import('@anthropic-ai/sdk')).default,
      client: {
        beta: {
          messages: {
            stream: (params: { tool_choice?: unknown }) => {
              choices.push(params.tool_choice)
              const last = params.tool_choice !== undefined
              return {
                finalMessage: async () => ({
                  model: 'claude-opus-5-5',
                  stop_reason: last ? 'end_turn' : 'tool_use',
                  stop_details: null,
                  content: last
                    ? [{ type: 'text', text: '답' }]
                    : [{ type: 'tool_use', id: `tu_${choices.length}`, name: 'get_routines', input: {} }],
                  usage: { input_tokens: 10, output_tokens: 10 },
                }),
              }
            },
          },
        },
      },
    } as never)
    const res = await runConversation({
      apiKey: 'k',
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'q' }],
      now: NOW,
      onCost: () => {},
      onActivity: () => {},
    })
    expect(res.text).toBe('답')
    expect(choices.at(-1)).toEqual({ type: 'none' })
    expect(choices.slice(0, -1).every((c) => c === undefined)).toBe(true)
  })
})
