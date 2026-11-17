import { db, type AiProfile } from '../../db'
import { getAiProfile, SETTING_KEYS } from '../settings'

/**
 * AI에게 알려 두는 내 목표와 상황(설정의 "내 정보"). 채운 항목만 요청 글에 넣는다.
 * 보통 설정이라 백업 파일에도 들어간다.
 */

type Goal = NonNullable<AiProfile['goal']>
type Experience = NonNullable<AiProfile['experience']>

/** label은 화면의 버튼, prompt는 AI에게 보내는 글 */
export const AI_GOALS: { value: Goal; label: string; prompt: string }[] = [
  { value: 'hypertrophy', label: '근비대', prompt: '근비대(근육 키우기)' },
  { value: 'strength', label: '근력', prompt: '근력(더 무거운 무게 들기)' },
  { value: 'fat-loss', label: '감량', prompt: '체지방 감량' },
  { value: 'health', label: '건강', prompt: '건강과 체력 유지' },
]

export const AI_EXPERIENCES: { value: Experience; label: string }[] = [
  { value: 'beginner', label: '초급' },
  { value: 'intermediate', label: '중급' },
  { value: 'advanced', label: '고급' },
]

export const AI_DAYS_RANGE = { min: 1, max: 7 } as const
export const AI_PROFILE_NOTES_MAX = 500

export function isAiProfileEmpty(p: AiProfile): boolean {
  return p.goal === null && p.experience === null && p.daysPerWeek === null && p.notes.trim() === ''
}

/** 요청 글에 넣을 줄. 채운 항목만 넣고, 모두 비어 있으면 빈 배열. */
export function profileLines(p: AiProfile): string[] {
  const lines: string[] = []
  const goal = AI_GOALS.find((g) => g.value === p.goal)
  if (goal) lines.push(`- 목표: ${goal.prompt}`)
  const experience = AI_EXPERIENCES.find((e) => e.value === p.experience)
  if (experience) lines.push(`- 운동 경력: ${experience.label}`)
  if (p.daysPerWeek !== null) lines.push(`- 주당 운동 목표: ${p.daysPerWeek}회`)
  const notes = p.notes.trim().replace(/\s+/g, ' ')
  if (notes !== '') lines.push(`- 참고할 점(부상, 피하고 싶은 동작 등): ${notes}`)
  return lines
}

/** 내 정보의 일부를 바꿔 저장한다. 범위를 벗어난 횟수는 지우고, 글은 앞뒤 공백을 빼고 길이를 맞춘다. */
export async function saveAiProfile(patch: Partial<AiProfile>): Promise<void> {
  await db.transaction('rw', db.settings, async () => {
    const next = { ...(await getAiProfile()), ...patch }
    const days = next.daysPerWeek
    await db.settings.put({
      key: SETTING_KEYS.aiProfile,
      value: {
        goal: next.goal,
        experience: next.experience,
        daysPerWeek:
          days !== null && Number.isInteger(days) && days >= AI_DAYS_RANGE.min && days <= AI_DAYS_RANGE.max ? days : null,
        notes: next.notes.trim().slice(0, AI_PROFILE_NOTES_MAX),
      } satisfies AiProfile,
    })
  })
}
