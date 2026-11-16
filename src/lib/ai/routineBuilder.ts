import { db, type RoutineItem } from '../../db'
import { newId } from '../id'
import { createRoutine, MISSING_EXERCISE_NAME, ROUTINE_NAME_MAX, ROUTINE_SETS_RANGE } from '../routines'
import { once, requireKey, type AdviceMeta } from './advice'
import { AiError, askClaudeJson } from './client'
import { buildRoutineContext, type RoutineCandidate } from './context'
import { addAiUsage, getAiModel } from './models'

/**
 * AI 루틴 만들기. 사용자가 적은 요청으로 루틴을 1~4개 제안받아 미리 보여 주고, 고른 것만 보통 루틴으로 저장한다.
 * 제안은 다른 AI 답처럼 폰에 하나만 저장해 두어, 화면을 다시 열어도 다시 요청하지 않는다.
 */

/** 제안을 저장하는 id이자 진행 중인 요청의 id */
export const ROUTINE_DRAFT_ID = 'routines'
/** 요청 글의 최대 길이 */
export const ROUTINE_REQUEST_MAX = 300
/** 한 번에 받는 루틴 수 */
export const ROUTINE_PROPOSALS_MAX = 4
/** 제안의 목표 횟수로 받아 주는 범위 */
export const PROPOSAL_REPS_RANGE = { min: 1, max: 50 } as const
/** 제안 한 개에 받아 주는 종목 수 */
const PROPOSAL_ITEMS_MAX = 12

/** AI가 제안한 루틴 하나(아직 저장하지 않은 것) */
export interface AiRoutineProposal {
  id: string
  name: string
  /** 이렇게 짠 까닭 한 줄 */
  rationale: string
  items: RoutineItem[]
}

export interface AiRoutineDraft {
  /** 사용자가 적은 요청 */
  request: string
  routines: AiRoutineProposal[]
}

/**
 * 제안은 aiAdvice 테이블에 한 줄로 둔다(백업에 넣지 않고, 복원하면 지워지는 것이 다른 AI 답과 같다).
 * db.ts의 AiAdvice에는 이 종류가 없어서 같은 테이블을 이 모양으로 따로 본다.
 */
interface RoutineDraftRow {
  id: string
  kind: 'routines'
  workoutId: null
  createdAt: number
  model: string
  costUsd: number
  data: AiRoutineDraft
}

const draftTable = () => db.table<RoutineDraftRow, string>('aiAdvice')

export const ROUTINE_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자가 원하는 루틴을 짧게 적어 보내면, 앱에 저장할 수 있는 루틴을 1~4개 제안합니다. 사용자는 폰에서 제안을 미리 보고 마음에 드는 것만 골라 저장합니다.

어떻게 짤지:
- 분할을 원하면 운동하는 날마다 루틴을 하나씩 만듭니다(상체/하체 분할이면 2개, 3분할이면 3개). 루틴 하나를 원하면 하나만 만듭니다. 4개를 넘기지 않습니다.
- 종목은 "고를 수 있는 종목"에서만 고르고 그 key(E1, E2 …)로 답합니다. 목록에 없는 종목은 넣지 않습니다.
- "내 정보"(목표, 운동 경력, 주당 운동 목표, 참고할 점, 체중)가 있으면 따릅니다. 참고할 점에 적힌 부상이나 피하고 싶은 동작에 걸리는 종목은 넣지 않습니다.
- 최근에 하던 종목은 이어 갈 수 있게 먼저 고려하고, 최근 부위별 세트 수에서 모자란 부위를 채웁니다. 기록이 없으면 누구나 하기 쉬운 기본 종목으로 짭니다.
- 한 루틴은 보통 4~7종목으로 하고 큰 복합 종목을 앞에 둡니다. 한 루틴에 같은 종목을 두 번 넣지 않습니다.
- sets는 본 세트 수(1~10), reps는 목표 횟수(1~50)입니다. "시간으로 재는 종목"은 reps를 null로 둡니다.
- 이미 저장한 루틴과 같은 구성은 피합니다. 요청이 그 루틴을 고쳐 달라는 것이면 고친 구성을 제안합니다.

어떻게 쓸지:
- name은 루틴 이름입니다. 목록에서 한 줄에 보이도록 한국어로 12자 안에서 짧게 씁니다(예: "상체 A", "하체 날").
- rationale은 이렇게 짠 까닭을 한국어 해요체 한 문장으로 씁니다.
- 요청이 운동 루틴과 관계없으면 routines를 빈 배열로 둡니다.
- 의학적 진단은 하지 마세요.`

export function routineSchema(keys: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      routines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rationale: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', enum: keys },
                  sets: { type: 'integer' },
                  reps: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
                },
                required: ['key', 'sets', 'reps'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'rationale', 'items'],
          additionalProperties: false,
        },
      },
    },
    required: ['routines'],
    additionalProperties: false,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max).trim() : '')
const intIn = (v: unknown, range: { min: number; max: number }): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= range.min && v <= range.max

/**
 * AI 답을 확인하고 저장할 수 있는 루틴 모양으로 바꾼다.
 * 모르는 key, 같은 종목의 두 번째 줄, 세트 수(1~10)나 목표 횟수(1~50 또는 null)가 맞지 않는 줄은 버리고,
 * 남은 종목이 없는 루틴도 버린다. 루틴은 4개까지만 받는다. 쓸 수 있는 루틴이 하나도 없으면 AiError.
 */
export function parseRoutineProposals(raw: unknown, candidates: RoutineCandidate[]): AiRoutineProposal[] {
  if (!isObj(raw) || !Array.isArray(raw.routines)) {
    throw new AiError('AI 답의 모양이 달라 읽지 못했습니다. 다시 시도해 주세요.', 'invalid')
  }
  const byKey = new Map(candidates.map((c) => [c.key, c]))
  const routines: AiRoutineProposal[] = []
  for (const r of raw.routines) {
    if (routines.length >= ROUTINE_PROPOSALS_MAX) break
    if (!isObj(r) || !Array.isArray(r.items)) continue
    const seen = new Set<string>()
    const items: RoutineItem[] = []
    for (const it of r.items) {
      if (items.length >= PROPOSAL_ITEMS_MAX) break
      if (!isObj(it) || typeof it.key !== 'string') continue
      const candidate = byKey.get(it.key)
      if (!candidate || seen.has(candidate.exerciseId)) continue
      if (!intIn(it.sets, ROUTINE_SETS_RANGE)) continue
      if (it.reps !== null && !intIn(it.reps, PROPOSAL_REPS_RANGE)) continue
      seen.add(candidate.exerciseId)
      // 시간으로 재는 종목에는 목표 횟수를 두지 않는다.
      items.push({ exerciseId: candidate.exerciseId, sets: it.sets, reps: candidate.timed ? null : it.reps })
    }
    if (items.length === 0) continue
    routines.push({
      id: newId(),
      name: oneLine(r.name, ROUTINE_NAME_MAX) || `AI 루틴 ${routines.length + 1}`,
      rationale: oneLine(r.rationale, 200),
      items,
    })
  }
  if (routines.length === 0) {
    throw new AiError('AI가 저장할 수 있는 루틴을 제안하지 못했습니다. 요청을 조금 더 자세히 적어 다시 시도해 주세요.', 'invalid')
  }
  return routines
}

/** 요청 글을 한 줄로 다듬는다(앞뒤 공백과 줄바꿈 정리, 길이 맞춤). */
export function normalizeRoutineRequest(text: string): string {
  return text.trim().replace(/\s+/g, ' ').slice(0, ROUTINE_REQUEST_MAX).trim()
}

/**
 * 루틴 제안을 받아 저장한다(전에 받은 제안은 새 제안으로 바뀐다). 요청이 진행 중이면 그 요청을 같이 기다린다.
 * 이 단계에서는 루틴이 만들어지지 않는다. saveRoutineProposals로 고른 것만 저장한다.
 */
export function requestRoutineProposals(requestText: string, now: number = Date.now()): Promise<AiRoutineDraft> {
  return once(ROUTINE_DRAFT_ID, () => fetchRoutineProposals(requestText, now))
}

async function fetchRoutineProposals(requestText: string, now: number): Promise<AiRoutineDraft> {
  const request = normalizeRoutineRequest(requestText)
  if (request === '') throw new AiError('어떤 루틴을 원하는지 적어 주세요.', 'request')
  const apiKey = await requireKey()
  const model = await getAiModel()
  const ctx = await buildRoutineContext(request, now)
  if (ctx.candidates.length === 0) throw new AiError('고를 수 있는 종목이 없습니다. 종목을 먼저 추가해 주세요.', 'request')

  const res = await askClaudeJson({
    apiKey,
    model,
    system: ROUTINE_SYSTEM,
    prompt: ctx.prompt,
    schema: routineSchema(ctx.candidates.map((c) => c.key)),
  })
  // 답을 읽지 못해도 요금은 이미 들었으니 센다.
  await addAiUsage(res.costUsd)
  const data: AiRoutineDraft = { request, routines: parseRoutineProposals(res.value, ctx.candidates) }
  await draftTable().put({
    id: ROUTINE_DRAFT_ID,
    kind: 'routines',
    workoutId: null,
    createdAt: Date.now(),
    model: res.servedModel,
    costUsd: res.costUsd,
    data,
  })
  return data
}

/** 화면에 그릴 제안 한 개. 종목 이름을 붙이고, 그사이 지워진 종목은 뺀다. */
export interface RoutineProposalView {
  id: string
  name: string
  rationale: string
  entries: { item: RoutineItem; name: string }[]
}

export interface RoutineDraftView {
  request: string
  proposals: RoutineProposalView[]
  meta: AdviceMeta
}

async function readDraftRow(): Promise<RoutineDraftRow | null> {
  const row = await draftTable().get(ROUTINE_DRAFT_ID)
  if (!row || row.kind !== 'routines' || !isObj(row.data) || !Array.isArray(row.data.routines)) return null
  return row
}

/** 저장해 둔 제안. 없으면 null. 종목이 모두 지워져 남은 것이 없는 루틴은 뺀다. */
export async function getRoutineDraft(): Promise<RoutineDraftView | null> {
  const row = await readDraftRow()
  if (!row) return null
  const ids = [...new Set(row.data.routines.flatMap((r) => r.items.map((it) => it.exerciseId)))]
  const found = await db.exercises.bulkGet(ids)
  const names = new Map(ids.flatMap((id, i) => (found[i] ? [[id, found[i].name] as const] : [])))
  const proposals = row.data.routines
    .map((r) => ({
      id: r.id,
      name: r.name,
      rationale: r.rationale,
      entries: r.items
        .filter((item) => names.has(item.exerciseId))
        .map((item) => ({ item, name: names.get(item.exerciseId) ?? MISSING_EXERCISE_NAME })),
    }))
    .filter((p) => p.entries.length > 0)
  if (proposals.length === 0) return null
  return {
    request: row.data.request,
    proposals,
    meta: { createdAt: row.createdAt, model: row.model, costUsd: row.costUsd },
  }
}

/**
 * 고른 제안을 보통 루틴으로 저장하고, 저장한 것은 제안에서 뺀다(남은 제안이 없으면 제안을 지운다).
 * 만든 루틴의 id를 제안 순서대로 돌려준다. 그사이 지워진 종목은 빼고 저장한다.
 */
export async function saveRoutineProposals(proposalIds: string[], now: number = Date.now()): Promise<string[]> {
  return db.transaction('rw', db.routines, db.exercises, db.aiAdvice, async () => {
    const row = await readDraftRow()
    if (!row) return []
    const chosen = row.data.routines.filter((r) => proposalIds.includes(r.id))
    const created: string[] = []
    for (const [i, r] of chosen.entries()) {
      const found = await db.exercises.bulkGet(r.items.map((it) => it.exerciseId))
      const items = r.items.filter((_, k) => found[k] !== undefined)
      if (items.length === 0) continue
      // 루틴 목록은 최근에 만든 것부터 보이므로, 제안 순서대로 보이게 앞의 것을 조금 더 늦은 시각으로 둔다.
      created.push(await createRoutine({ name: r.name, items }, now + chosen.length - 1 - i))
    }
    const left = row.data.routines.filter((r) => !proposalIds.includes(r.id))
    if (left.length === 0) await draftTable().delete(ROUTINE_DRAFT_ID)
    else await draftTable().put({ ...row, data: { ...row.data, routines: left } })
    return created
  })
}

/** 받은 제안을 지운다. */
export async function discardRoutineDraft(): Promise<void> {
  await draftTable().delete(ROUTINE_DRAFT_ID)
}
