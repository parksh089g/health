import { createContext, useContext } from 'react'

export interface RestTimerValue {
  /** 타이머가 돌고 있거나 방금 끝났으면 true */
  active: boolean
  /** 휴식이 끝나 알림을 보여 주는 중이면 true */
  finished: boolean
  /** 남은 시간(ms). 끝났으면 0 */
  remainingMs: number
  /** 이번 휴식의 전체 길이(초) */
  durationSeconds: number
  /** 휴식을 시작한다. 길이를 주지 않으면 설정의 기본값을 쓴다. */
  start: (seconds?: number) => void
  /** 돌고 있는 휴식의 길이를 바꾼다. 시작한 시각은 그대로 둔다. */
  changeDuration: (seconds: number) => void
  stop: () => void
}

export const RestTimerContext = createContext<RestTimerValue | null>(null)

export function useRestTimer(): RestTimerValue {
  const value = useContext(RestTimerContext)
  if (!value) throw new Error('RestTimerProvider 안에서만 쓸 수 있습니다.')
  return value
}
