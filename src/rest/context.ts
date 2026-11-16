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
  /**
   * 휴식을 시작한다. 종목에 정해 둔 휴식 시간(초)을 주면 그 길이로,
   * 주지 않거나 쓸 수 없는 값이면 설정의 기본값으로 시작한다.
   */
  start: (seconds?: number | null) => void
  /**
   * 돌고 있는 휴식의 길이를 바꾼다. 시작한 시각은 그대로 둔다.
   * 기본값으로 시작한 휴식이면 고른 길이가 새 기본값이 되고, 종목의 시간으로 시작한 휴식이면 이번만 바뀐다.
   */
  changeDuration: (seconds: number) => void
  /** 이번 휴식의 남은 시간을 늘리거나(양수) 줄인다(음수). 기본값은 바꾸지 않는다. */
  adjust: (deltaSeconds: number) => void
  /** 그만큼 늘리거나 줄일 수 있는지. 줄여서 바로 끝나 버리거나 한계를 넘으면 false */
  canAdjust: (deltaSeconds: number) => boolean
  stop: () => void
}

export const RestTimerContext = createContext<RestTimerValue | null>(null)

export function useRestTimer(): RestTimerValue {
  const value = useContext(RestTimerContext)
  if (!value) throw new Error('RestTimerProvider 안에서만 쓸 수 있습니다.')
  return value
}
