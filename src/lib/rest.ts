import { REST_RANGE } from './settings'

/**
 * 휴식 타이머의 계산. 시작한 시각과 끝나는 시각(ms)만 들고 있어서,
 * 화면이 꺼졌다 켜지거나 앱을 나갔다 와도 남은 시간이 어긋나지 않는다.
 */
export interface RestTimer {
  startedAt: number
  endsAt: number
  /**
   * 종목에 정해 둔 휴식 시간으로 시작했으면 true.
   * 이때는 타이머에서 다른 시간을 골라도 그 휴식만 바뀌고 기본값은 그대로다.
   */
  ownTime?: boolean
}

/** 타이머에서 한 번에 늘리거나 줄이는 시간(초) */
export const REST_STEP_SECONDS = 15

export function startRest(now: number, seconds: number, ownTime = false): RestTimer {
  const timer: RestTimer = { startedAt: now, endsAt: now + seconds * 1000 }
  if (ownTime) timer.ownTime = true
  return timer
}

/** 이번 휴식의 전체 길이(초) */
export function restDurationSeconds(timer: RestTimer): number {
  return Math.round((timer.endsAt - timer.startedAt) / 1000)
}

/** 휴식의 전체 길이를 바꾼다. 시작한 시각은 그대로 두므로 이미 쉰 시간만큼 남은 시간이 줄어든다. */
export function setRestDuration(timer: RestTimer, seconds: number): RestTimer {
  return { ...timer, endsAt: timer.startedAt + seconds * 1000 }
}

/**
 * 남은 시간을 늘리거나(양수) 줄일(음수) 수 있는지.
 * 줄여서 바로 끝나 버리는 경우(건너뛰기를 쓰면 된다)와 남은 시간이 한계를 넘는 경우는 안 된다.
 */
export function canAdjustRest(timer: RestTimer, deltaSeconds: number, now: number): boolean {
  const remaining = timer.endsAt - now
  if (remaining <= 0) return false
  const next = remaining + deltaSeconds * 1000
  return next > 0 && next <= REST_RANGE.max * 1000
}

/** 남은 시간을 늘리거나 줄인다. 할 수 없으면 그대로 돌려준다. */
export function adjustRest(timer: RestTimer, deltaSeconds: number, now: number): RestTimer {
  if (!canAdjustRest(timer, deltaSeconds, now)) return timer
  return { ...timer, endsAt: timer.endsAt + deltaSeconds * 1000 }
}

/** 저장해 둔 타이머를 읽는다. 모양이 맞지 않으면 null */
export function parseRestTimer(raw: string | null): RestTimer | null {
  if (!raw) return null
  try {
    const t: unknown = JSON.parse(raw)
    if (typeof t !== 'object' || t === null) return null
    const { startedAt, endsAt, ownTime } = t as Partial<RestTimer>
    if (typeof startedAt !== 'number' || typeof endsAt !== 'number') return null
    if (!Number.isFinite(startedAt) || !Number.isFinite(endsAt) || endsAt < startedAt) return null
    return ownTime === true ? { startedAt, endsAt, ownTime } : { startedAt, endsAt }
  } catch {
    return null
  }
}
