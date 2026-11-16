const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 로컬 시간 기준 YYYY-MM-DD */
export function toDateKey(ts: number | Date): string {
  const d = typeof ts === 'number' ? new Date(ts) : ts
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 그 주의 월요일 0시(로컬 시간) */
export function startOfWeek(ts: number | Date): Date {
  const d = new Date(typeof ts === 'number' ? ts : ts.getTime())
  d.setHours(0, 0, 0, 0)
  const sinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - sinceMonday)
  return d
}

/** "11월 16일 (월)" */
export function formatDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`
}

/** "2026년 11월" */
export function formatMonth(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`
}

/** "2026년 11월 16일" */
export function formatFullDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`
}

/** "오후 9:41" */
export function formatTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h < 12 ? '오전' : '오후'} ${h % 12 === 0 ? 12 : h % 12}:${m}`
}

/** 운동 시간. "45분", "1시간 12분" */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}분`
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

/** 타이머 표시. "1:05", "1:02:03" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/** 무게. 60 → "60", 62.5 → "62.5" */
export function formatKg(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** 볼륨. 12340 → "12,340" */
export function formatVolume(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}
