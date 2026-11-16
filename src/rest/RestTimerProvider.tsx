import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  adjustRest,
  canAdjustRest,
  parseRestTimer,
  restDurationSeconds,
  setRestDuration,
  startRest,
  type RestTimer,
} from '../lib/rest'
import { DEFAULT_REST_SECONDS, SETTING_KEYS, getRestSeconds, isRestSeconds, setSetting } from '../lib/settings'
import { alertRestOver, releaseAudio, unlockAudio } from './alert'
import { RestTimerContext, type RestTimerValue } from './context'

const STORAGE_KEY = 'health.restTimer'
/** 휴식이 끝난 뒤 "휴식 끝" 표시를 남겨 두는 시간 */
const FINISHED_SHOW_MS = 8000
/** 끝난 지 이 시간이 넘었으면(화면을 꺼 뒀다가 돌아온 경우) 소리와 진동은 생략한다 */
const ALERT_WINDOW_MS = 3000

function loadTimer(): RestTimer | null {
  try {
    const timer = parseRestTimer(sessionStorage.getItem(STORAGE_KEY))
    return timer && Date.now() < timer.endsAt + FINISHED_SHOW_MS ? timer : null
  } catch {
    return null
  }
}

function saveTimer(timer: RestTimer | null): void {
  try {
    if (timer) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(timer))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장이 막힌 환경이면 새로고침할 때 타이머가 사라질 뿐이다.
  }
}

export function RestTimerProvider({ children }: { children: ReactNode }) {
  const [timer, setTimer] = useState<RestTimer | null>(loadTimer)
  const [now, setNow] = useState(() => Date.now())
  const alertedFor = useRef<number | null>(null)
  const restSeconds = useLiveQuery(getRestSeconds) ?? DEFAULT_REST_SECONDS

  useEffect(() => {
    saveTimer(timer)
    if (!timer) releaseAudio()
  }, [timer])

  // 남은 시간은 끝나는 시각에서 계산한다. 화면이 꺼졌다 켜져도 어긋나지 않는다.
  useEffect(() => {
    if (!timer) return
    const tick = () => {
      const t = Date.now()
      setNow(t)
      const overBy = t - timer.endsAt
      if (overBy < 0) return
      if (alertedFor.current !== timer.endsAt) {
        alertedFor.current = timer.endsAt
        if (overBy < ALERT_WINDOW_MS) alertRestOver()
      }
      if (overBy >= FINISHED_SHOW_MS) setTimer(null)
    }
    const id = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [timer])

  // 쉬는 동안에는 화면이 꺼지지 않게 한다. 지원하지 않는 기기에서는 그냥 넘어간다.
  const running = timer !== null && now < timer.endsAt
  useEffect(() => {
    if (!running || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (cancelled) void l.release()
          else lock = l
        })
        .catch(() => undefined)
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release().catch(() => undefined)
    }
  }, [running])

  const start = useCallback(
    (seconds?: number | null) => {
      unlockAudio()
      const t = Date.now()
      setNow(t)
      // 종목에 정해 둔 시간이 있으면 그 시간으로, 없으면 설정의 기본값으로 쉰다.
      setTimer(isRestSeconds(seconds) ? startRest(t, seconds, true) : startRest(t, restSeconds))
    },
    [restSeconds],
  )

  // 종목의 시간으로 시작한 휴식에서 고른 길이는 기본값으로 저장하지 않는다(스쿼트의 4분이 모든 종목의 기본값이 되지 않게).
  const ownTime = timer?.ownTime === true
  const changeDuration = useCallback(
    (seconds: number) => {
      if (!isRestSeconds(seconds)) return
      if (!ownTime) void setSetting(SETTING_KEYS.restSeconds, seconds)
      setNow(Date.now())
      setTimer((cur) => (cur ? setRestDuration(cur, seconds) : cur))
    },
    [ownTime],
  )

  const adjust = useCallback((deltaSeconds: number) => {
    const t = Date.now()
    setNow(t)
    setTimer((cur) => (cur ? adjustRest(cur, deltaSeconds, t) : cur))
  }, [])

  const stop = useCallback(() => setTimer(null), [])

  const value = useMemo<RestTimerValue>(() => {
    const remainingMs = timer ? Math.max(0, timer.endsAt - now) : 0
    return {
      active: timer !== null,
      finished: timer !== null && remainingMs === 0,
      remainingMs,
      durationSeconds: timer ? restDurationSeconds(timer) : restSeconds,
      start,
      changeDuration,
      adjust,
      canAdjust: (deltaSeconds) => timer !== null && canAdjustRest(timer, deltaSeconds, now),
      stop,
    }
  }, [timer, now, restSeconds, start, changeDuration, adjust, stop])

  return <RestTimerContext.Provider value={value}>{children}</RestTimerContext.Provider>
}
