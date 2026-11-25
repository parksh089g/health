import type AnthropicClient from '@anthropic-ai/sdk'
import { toDateKey } from '../format'
import { getAiProfile, getWeeklyGoal } from '../settings'
import { requireKey } from './advice'
import { AiError, ANSWER_TIMEOUT_MS, answerText, assertOnline, costOfUsage, createClient, toAiError } from './client'
import { CHAT_TOOLS, loadChatData, runChatTool, toolActivityLabel } from './chatTools'
import { bodyWeightLine } from './context'
import { addAiUsage, aiModelInfo, estimateCostUsd, formatUsd, getAiModel, type AiModelId } from './models'
import { profileLines } from './profile'

/**
 * "내 기록에 물어보기": 사용자가 글로 묻고, Claude가 도구(chatTools.ts)로 폰의 기록에서 필요한 것만 꺼내 답한다.
 * 보낼 때만 요청하고, 대화는 이 폰의 브라우저 저장소(localStorage)에만 둔다(백업과 클라우드 백업에는 넣지 않는다).
 */

type MessageParam = AnthropicClient.Beta.BetaMessageParam
type ToolResult = AnthropicClient.Beta.BetaToolResultBlockParam

export const CHAT_SYSTEM = `당신은 개인용 헬스 기록 앱 안의 코치입니다. 사용자가 자기 운동 기록, 체중, 체성분(골격근량, 체지방량)에 대해 묻는 질문에 답하고, 원하면 운동 계획을 세워 줍니다. 사용자는 폰 화면에서 이 답을 읽습니다.

기록 보는 법:
- 기록은 도구로만 볼 수 있습니다. 답에 필요한 도구만 부르고, 서로 상관없는 도구는 한 번에 같이 부르세요. 기록에 없는 숫자는 지어내지 말고, 도구가 준 값을 그대로 인용하세요.
- 종목 이름이 애매하면(예: "벤치", "스쿼트") find_exercises로 먼저 찾아 기록이 있는 종목을 고르세요. 여럿이 맞으면 기록이 많은 것을 쓰고, 답에 어느 종목인지 밝히세요.
- "지난달", "이번 주", "최근 3개월" 같은 말은 첫 메시지의 오늘 날짜를 기준으로 YYYY-MM-DD 기간으로 바꿔 도구에 넘기세요. 주는 월요일에 시작합니다.
- 전체 상태를 묻거나 계획을 세워 달라고 하면 get_training_summary, get_body_composition, get_routines와 자주 하는 주요 종목의 기록을 함께 보고 종합해서 답하세요. 체성분 기록이 없으면 체중으로만 판단하고, 골격근량과 체지방량을 통계 화면의 체중 기록에 적어 두면 더 정확해진다고 한 줄로 알려 주세요.
- 무게 기록: "60kg×8"은 60kg으로 8회, 맨몸 종목의 "+10kg×8"은 몸에 10kg을 더 달고 8회, 무게 없이 "10회"는 맨몸으로 한 세트입니다. (RPE n)은 사용자가 적은 힘든 정도입니다(10이 한계). 보조 머신의 무게는 몸무게를 덜어 주는 보조 무게라 낮을수록 어렵습니다. 볼륨과 추정 1RM은 웜업을 뺀 본 세트로 계산합니다.
- 체지방률은 체지방량을 그날 체중으로 나눈 값입니다. 측정 기기나 시간대에 따라 체성분 값은 하루하루 흔들릴 수 있으니, 한 번의 차이보다 몇 주의 흐름을 보세요.

쓰는 법:
- 한국어 해요체로, 첫 문장에서 질문에 바로 답하고 근거를 짧게 붙입니다. 간단한 질문은 1~3문장이면 충분합니다.
- 계획을 세울 때는 "내 정보"의 목표, 운동 경력, 주당 횟수, 참고할 점(부상, 피하고 싶은 동작)을 꼭 지키세요. 요일이나 주차별로 종목, 세트×횟수, 무게를 사용자의 최근 기록에 맞춰 구체적으로 쓰고, 체성분 목표가 있으면 현실적인 변화 폭(한 달 단위)과 그렇게 정한 근거도 씁니다.
- 식단은 단백질 섭취량이나 완만한 열량 조절 같은 일반적인 기준까지만 말하고, 약이나 극단적인 식단은 권하지 마세요. 의학적 진단은 하지 말고, 통증이 이어진다면 전문가와 상담하라고 짧게만 말하세요.
- 마크다운 표, 굵은 글씨, 제목(#)은 쓰지 마세요. 짧은 문단과 "- "로 시작하는 목록만 씁니다.
- 기록이나 운동과 상관없는 질문에는 이 앱의 기록에 대해 물어 달라고 짧게 답하세요.`

/** 한 질문에서 도구를 부르며 주고받는 최대 횟수. 마지막 번에는 도구 없이 답하게 한다. */
export const MAX_ROUNDS = 6
/** 한 대화에서 물을 수 있는 질문 수. 길어질수록 요금이 늘어서 새 대화를 권한다. */
export const MAX_QUESTIONS = 20
export const QUESTION_MAX = 500

/** 질문 한 번의 토큰 어림값(도구를 두세 번 부르는 동안 지시문과 도구 설명을 다시 읽는 것과 생각하는 토큰 포함) */
const TYPICAL_CHAT_USAGE = { input_tokens: 8000, output_tokens: 2000 }

/**
 * 다음 질문의 어림 요금. 이어서 묻는 질문은 앞의 대화를 다시 보내므로 그만큼 더한다
 * (5분 안에 이어 물으면 대부분 캐시에서 싸게 읽지만, 넉넉하게 처음 한 번은 제값으로 친다).
 */
export function chatCostEstimate(model: AiModelId, historyTokens: number): number {
  return estimateCostUsd(
    { input_tokens: TYPICAL_CHAT_USAGE.input_tokens + Math.round(historyTokens * 1.5), output_tokens: TYPICAL_CHAT_USAGE.output_tokens },
    model,
    model,
  )
}

export function chatCostText(model: AiModelId, historyTokens: number): string {
  return formatUsd(chatCostEstimate(model, historyTokens))
}

interface CacheUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

/** 캐시에 쓴 토큰은 1.25배, 캐시에서 읽은 토큰은 0.1배로 입력 토큰에 더한다. */
function withCache<T extends CacheUsage>(u: T): T {
  const write = u.cache_creation_input_tokens ?? 0
  const read = u.cache_read_input_tokens ?? 0
  return { ...u, input_tokens: u.input_tokens + write * 1.25 + read * 0.1 }
}

/** 한 번 주고받은 요금. 캐시와, 거절로 다른 모델이 이어 답한 시도까지 센다. */
export function chatRoundCost(
  usage: CacheUsage & {
    iterations?: Array<CacheUsage & { type: string; model?: string | null }> | null
  },
  servedModel: string,
  requestedModel: AiModelId,
): number {
  return costOfUsage(
    { ...withCache(usage), iterations: usage.iterations?.map((it) => withCache(it)) ?? null },
    servedModel,
    requestedModel,
  )
}

/** 첫 질문 앞에 붙이는 오늘 날짜와 내 정보 */
export async function chatIntro(now: number): Promise<string> {
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']
  const lines = [`오늘: ${toDateKey(now)}(${weekdays[new Date(now).getDay()]})`]
  const me = profileLines(await getAiProfile())
  const goal = await getWeeklyGoal()
  if (goal !== null && !me.some((l) => l.includes('주당 운동 목표'))) me.push(`- 주간 목표: 주 ${goal}회`)
  const weight = await bodyWeightLine(now)
  if (weight) me.push(`- ${weight}`)
  if (me.length > 0) lines.push('내 정보:', ...me)
  return lines.join('\n')
}

// ───────── 대화 상태

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  /** 답에만: 실제로 답한 모델, 어림 요금, 본 기록 */
  model?: string
  costUsd?: number
  looked?: string[]
}

export interface ChatState {
  turns: ChatTurn[]
  /** API에 그대로 보내는 대화(도구 호출과 결과, 생각 블록 포함) */
  messages: MessageParam[]
  /** 마지막 요청의 입력 토큰 수(캐시 포함). 다음 질문의 요금 어림에 쓴다. */
  historyTokens: number
  busy: boolean
  /** 기다리는 동안 보여 줄 지금 보는 기록들 */
  activity: string[]
  error: AiError | null
  /** 실패한 질문. 입력 칸에 되돌려 놓는다. */
  failedQuestion: string | null
}

const STORAGE_KEY = 'health-ai-chat-v1'

function loadSaved(): Pick<ChatState, 'turns' | 'messages' | 'historyTokens'> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<ChatState>
      if (Array.isArray(v.turns) && Array.isArray(v.messages) && typeof v.historyTokens === 'number') {
        return { turns: v.turns, messages: v.messages, historyTokens: v.historyTokens }
      }
    }
  } catch {
    // 저장소를 쓸 수 없거나(사생활 보호 모드 등) 내용이 깨졌으면 빈 대화로 시작한다.
  }
  return { turns: [], messages: [], historyTokens: 0 }
}

function save(s: ChatState): void {
  try {
    if (s.turns.length === 0) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ turns: s.turns, messages: s.messages, historyTokens: s.historyTokens }))
  } catch {
    // 저장하지 못해도 이번에 연 동안은 대화가 남는다.
  }
}

let state: ChatState = { ...loadSaved(), busy: false, activity: [], error: null, failedQuestion: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<ChatState>): void {
  state = { ...state, ...patch }
  if ('turns' in patch || 'messages' in patch) save(state)
  listeners.forEach((l) => l())
}

export function subscribeChat(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getChatState(): ChatState {
  return state
}

/** 새 대화. 답을 기다리는 중에는 지우지 않는다. */
export function resetChat(): void {
  if (state.busy) return
  setState({ turns: [], messages: [], historyTokens: 0, error: null, failedQuestion: null, activity: [] })
}

export function clearChatError(): void {
  setState({ error: null, failedQuestion: null })
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()))

/** 질문을 보내고 답을 대화에 더한다. 실패하면 대화는 질문 전으로 돌아가고 error에 까닭이 남는다. */
export async function askChat(question: string, now: number = Date.now()): Promise<void> {
  const q = question.trim().slice(0, QUESTION_MAX)
  if (q === '' || state.busy) return
  if (state.turns.filter((t) => t.role === 'user').length >= MAX_QUESTIONS) {
    setState({ error: new AiError('대화가 길어졌어요. "새 대화"를 눌러 다시 시작해 주세요.', 'request'), failedQuestion: q })
    return
  }
  const before = { turns: state.turns, messages: state.messages }
  const userTurn: ChatTurn = { id: newId(), role: 'user', text: q, createdAt: Date.now() }
  setState({ busy: true, error: null, failedQuestion: null, activity: [], turns: [...state.turns, userTurn] })

  let spent = 0
  try {
    const apiKey = await requireKey()
    const model = await getAiModel()
    const content = before.messages.length === 0 ? `${await chatIntro(now)}\n\n질문: ${q}` : q
    const result = await runConversation({
      apiKey,
      model,
      messages: [...before.messages, { role: 'user', content }],
      now,
      onCost: (c) => (spent += c),
      onActivity: (label) => setState({ activity: state.activity.includes(label) ? state.activity : [...state.activity, label] }),
    })
    await addAiUsage(spent)
    const answer: ChatTurn = {
      id: newId(),
      role: 'assistant',
      text: result.text,
      createdAt: Date.now(),
      model: result.servedModel,
      costUsd: spent,
      looked: state.activity,
    }
    setState({
      busy: false,
      activity: [],
      turns: [...before.turns, userTurn, answer],
      messages: result.messages,
      historyTokens: result.historyTokens,
    })
  } catch (e) {
    // 요금이 든 요청은 실패해도 사용량에 더한다.
    if (spent > 0) await addAiUsage(spent).catch(() => {})
    const error = e instanceof AiError ? e : new AiError('AI 요청 중에 문제가 생겼습니다. 다시 시도해 주세요.', 'request')
    setState({ busy: false, activity: [], turns: before.turns, messages: before.messages, error, failedQuestion: q })
  }
}

interface ConversationRequest {
  apiKey: string
  model: AiModelId
  messages: MessageParam[]
  now: number
  onCost: (usd: number) => void
  onActivity: (label: string) => void
}

/**
 * 도구를 부르는 동안 주고받기를 이어 가고 마지막 답의 글을 돌려준다.
 * 받은 content는 생각 블록과 대체 모델 블록까지 그대로 대화에 넣어 다음 요청에 보낸다.
 */
export async function runConversation(req: ConversationRequest): Promise<{
  text: string
  servedModel: string
  messages: MessageParam[]
  historyTokens: number
}> {
  assertOnline()
  const { Anthropic, client } = await createClient(req.apiKey)
  const info = aiModelInfo(req.model)
  const messages = [...req.messages]
  const data = await loadChatData()

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), ANSWER_TIMEOUT_MS)
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS - 1
      let response: AnthropicClient.Beta.BetaMessage
      try {
        response = await client.beta.messages
          .stream(
            {
              model: req.model,
              max_tokens: 16000,
              ...(info?.fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
              // 지시문, 도구 설명, 앞의 대화를 캐시해 두어 도구를 부를 때마다 다시 읽는 요금을 줄인다.
              cache_control: { type: 'ephemeral' },
              output_config: { effort: 'medium' },
              system: CHAT_SYSTEM,
              tools: CHAT_TOOLS,
              // 마지막 번에는 도구를 못 부르게 해서 지금까지 본 기록으로 답하게 한다.
              ...(last ? { tool_choice: { type: 'none' as const } } : {}),
              messages,
            },
            { signal: abort.signal },
          )
          .finalMessage()
      } catch (e) {
        throw toAiError(e, Anthropic)
      }
      req.onCost(chatRoundCost(response.usage, response.model, req.model))

      if (response.stop_reason === 'refusal') {
        throw new AiError('AI가 이 질문에는 답하지 않았습니다.', 'refusal', response.stop_details?.explanation ?? undefined)
      }
      if (response.stop_reason === 'max_tokens') {
        throw new AiError('AI 답이 너무 길어 잘렸습니다. 질문을 좁혀 다시 시도해 주세요.', 'truncated')
      }
      messages.push({ role: 'assistant', content: response.content as AnthropicClient.Beta.BetaContentBlockParam[] })
      const uses = response.content.filter((b): b is AnthropicClient.Beta.BetaToolUseBlock => b.type === 'tool_use')

      if (response.stop_reason !== 'tool_use' || uses.length === 0) {
        const text = cleanAnswer(answerText(response.content as { type: string; text?: string }[]))
        if (text === '') throw new AiError('AI 답이 비어 있습니다. 다시 시도해 주세요.', 'invalid')
        const u = response.usage
        const historyTokens = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens
        return { text, servedModel: response.model, messages, historyTokens }
      }

      for (const u of uses) req.onActivity(toolActivityLabel(u.name, u.input))
      const results: ToolResult[] = await Promise.all(
        uses.map(async (u) => {
          const out = await runChatTool(u.name, u.input, { data, now: req.now })
          return { type: 'tool_result' as const, tool_use_id: u.id, content: out.text, ...(out.isError ? { is_error: true } : {}) }
        }),
      )
      messages.push({ role: 'user', content: results })
    }
    throw new AiError('AI가 답을 끝내지 못했습니다. 질문을 좁혀 다시 시도해 주세요.', 'invalid')
  } finally {
    clearTimeout(timer)
  }
}

/** 화면에 맞게 다듬는다. 굵은 글씨 표시와 제목 기호를 빼고, 빈 줄이 셋 이상 이어지면 줄인다. */
export function cleanAnswer(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
