/**
 * 스톱워치의 계산. 시간 종목(플랭크)과 유산소 종목의 세트 시간을 잰다. (5단계)
 * 휴식 타이머처럼 시작한 시각(ms)만 들고 있어서, 화면이 꺼졌다 켜지거나 앱을 나갔다 와도 흐른 시간이 어긋나지 않는다.
 * 앱 전체에서 한 번에 하나만 돈다. 저장과 알림은 src/stopwatch/store.ts가 맡는다.
 */
export interface Stopwatch {
  /** 시간을 재고 있는 세트 */
  setId: string
  startedAt: number
  /** 목표 시간(초). 시간 종목에 목표 시간이 있을 때만 있다. 지나면 한 번 알리고 계속 센다. */
  targetSec?: number
  /** 목표 시간을 지나 이미 알렸으면 true(새로 고쳐도 다시 울리지 않게 함께 저장한다) */
  alerted?: boolean
}

/** 목표 시간으로 쓸 수 있는 값이면 그 값(정수 초), 아니면 undefined */
function validTarget(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.round(v) : undefined
}

export function startStopwatch(setId: string, now: number, targetSec?: number | null): Stopwatch {
  const sw: Stopwatch = { setId, startedAt: now }
  const target = validTarget(targetSec)
  if (target !== undefined) sw.targetSec = target
  return sw
}

/** 흐른 시간(ms). 시계가 뒤로 돌아가도 0 아래로 내려가지 않는다. */
export function stopwatchElapsedMs(sw: Stopwatch, now: number): number {
  return Math.max(0, now - sw.startedAt)
}

/** 세트에 적을 시간(초). 반올림하고, 바로 멈춰도 1초는 적는다(0초는 적지 않은 세트로 보기 때문). */
export function stopwatchSeconds(sw: Stopwatch, now: number): number {
  return Math.max(1, Math.round(stopwatchElapsedMs(sw, now) / 1000))
}

/** 목표 시간까지 남은 시간(ms). 지났으면 음수. 목표가 없으면 null */
export function stopwatchTargetLeftMs(sw: Stopwatch, now: number): number | null {
  return sw.targetSec === undefined ? null : sw.targetSec * 1000 - stopwatchElapsedMs(sw, now)
}

/** 목표 시간을 채웠는지. 목표가 없으면 false */
export function stopwatchReachedTarget(sw: Stopwatch, now: number): boolean {
  const left = stopwatchTargetLeftMs(sw, now)
  return left !== null && left <= 0
}

/** 저장해 둔 스톱워치를 읽는다. 모양이 맞지 않으면 null */
export function parseStopwatch(raw: string | null): Stopwatch | null {
  if (!raw) return null
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const { setId, startedAt, targetSec, alerted } = v as Partial<Stopwatch>
    if (typeof setId !== 'string' || setId === '') return null
    if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null
    const sw: Stopwatch = { setId, startedAt }
    const target = validTarget(targetSec)
    if (target !== undefined) {
      sw.targetSec = target
      if (alerted === true) sw.alerted = true
    }
    return sw
  } catch {
    return null
  }
}
