import { liveQuery, type Subscription } from 'dexie'
import { db } from '../db'
import {
  parseStopwatch,
  startStopwatch,
  stopwatchSeconds,
  stopwatchTargetLeftMs,
  type Stopwatch,
} from '../lib/stopwatch'
import { alertRestOver, unlockAudio } from '../rest/alert'

/**
 * 돌고 있는 스톱워치를 들고 있는 곳. 앱 전체에서 하나뿐이다. (5단계)
 *
 * 화면(종목 카드)이 사라져도 계속 돌아야 하므로 컴포넌트가 아니라 모듈에 둔다.
 * - 시작한 시각을 localStorage에 적어 둬서 다른 화면에 다녀오거나 새로 고치거나 앱을 닫았다 열어도 이어진다.
 * - 재던 세트가 지워지거나(세트 삭제, 종목 빼기, 운동 마치기와 취소) 다른 방법으로 완료되면 스스로 사라진다.
 *   그런 일이 일어나는 곳마다 따로 부르지 않아도 되도록 그 세트를 지켜본다.
 * - 목표 시간이 있으면 지나는 순간 한 번 진동과 소리로 알리고(휴식 타이머와 같은 알림) 계속 센다.
 */

const STORAGE_KEY = 'health.stopwatch'
/** 목표 시간을 지난 지 이 시간이 넘었으면(화면을 꺼 뒀다가 돌아온 경우) 소리와 진동은 생략한다 */
const ALERT_WINDOW_MS = 3000
/** 목표 시간 이만큼 전부터 소리를 낼 준비를 한다(휴식 타이머가 끝나면서 오디오를 멈춰 뒀을 수 있다) */
const PREPARE_MS = 2000

function load(): Stopwatch | null {
  try {
    return parseStopwatch(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function save(sw: Stopwatch | null): void {
  try {
    if (sw) localStorage.setItem(STORAGE_KEY, JSON.stringify(sw))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장이 막힌 환경이면 새로고침할 때 스톱워치가 사라질 뿐이다.
  }
}

let current: Stopwatch | null = load()
const listeners = new Set<() => void>()
let ticker: number | null = null
let watching: { setId: string; subscription: Subscription } | null = null

/** 사용자가 이 화면을 한 번이라도 눌렀는지. 누르기 전에는 브라우저가 소리와 진동을 막고 경고를 남긴다. */
function canAlert(): boolean {
  return navigator.userActivation?.hasBeenActive !== false
}

/** 목표 시간을 지났는지 본다. 지나는 순간 한 번만 알린다. */
function tick(): void {
  const sw = current
  if (!sw || sw.alerted) return
  const left = stopwatchTargetLeftMs(sw, Date.now())
  if (left === null || left > PREPARE_MS) return
  if (left > 0) {
    if (canAlert()) unlockAudio()
    return
  }
  apply({ ...sw, alerted: true })
  if (-left < ALERT_WINDOW_MS && canAlert()) alertRestOver()
}

/** 지금 상태에 맞게 목표 시간 확인과 세트 지켜보기를 켜고 끈다. */
function sync(): void {
  const needsTick = current !== null && current.targetSec !== undefined && !current.alerted
  if (needsTick && ticker === null) {
    ticker = window.setInterval(tick, 250)
    document.addEventListener('visibilitychange', tick)
  } else if (!needsTick && ticker !== null) {
    window.clearInterval(ticker)
    document.removeEventListener('visibilitychange', tick)
    ticker = null
  }

  const setId = current?.setId
  if (watching && watching.setId !== setId) {
    watching.subscription.unsubscribe()
    watching = null
  }
  if (setId !== undefined && !watching) {
    const subscription = liveQuery(() => db.sets.get(setId)).subscribe({
      next: (set) => {
        // 세트가 지워졌거나 이미 완료됐으면 더 잴 것이 없다.
        if (current?.setId === setId && (!set || set.isDone)) apply(null)
      },
      error: () => undefined,
    })
    watching = { setId, subscription }
  }
}

function apply(next: Stopwatch | null): void {
  current = next
  save(next)
  sync()
  for (const listener of listeners) listener()
}

export function subscribeStopwatch(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 돌고 있는 스톱워치. 없으면 null */
export function getStopwatch(): Stopwatch | null {
  return current
}

/**
 * 세트의 시간을 재기 시작한다. 이미 돌고 있는 스톱워치가 있으면 그것을 버리고 새로 시작한다
 * (화면에서는 다른 종목을 재는 동안 시작 버튼을 꺼 둔다).
 * 화면을 누른 순간에 불러야 한다. 목표 시간이 있으면 그때 소리를 낼 수 있게 준비해 둔다.
 */
export function beginStopwatch(setId: string, targetSec?: number | null): void {
  const sw = startStopwatch(setId, Date.now(), targetSec)
  if (sw.targetSec !== undefined) unlockAudio()
  apply(sw)
}

/** 기록하지 않고 그만둔다. */
export function cancelStopwatch(): void {
  if (current) apply(null)
}

/** 스톱워치를 멈추고, 재던 세트와 잰 시간(초)을 돌려준다. 돌고 있지 않았으면 null */
export function takeStopwatch(): { setId: string; seconds: number } | null {
  const sw = current
  if (!sw) return null
  apply(null)
  return { setId: sw.setId, seconds: stopwatchSeconds(sw, Date.now()) }
}

// 다른 탭에서 시작하거나 멈춘 것도 따라간다.
window.addEventListener('storage', (e) => {
  if (e.key !== STORAGE_KEY) return
  current = load()
  sync()
  for (const listener of listeners) listener()
})

// 앱을 다시 열었을 때 이어서 돌던 스톱워치가 있으면 바로 지켜보기 시작한다.
sync()
