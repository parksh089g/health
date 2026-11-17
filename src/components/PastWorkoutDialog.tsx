import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toDateKey } from '../lib/format'
import { PAST_MINUTES_RANGE, pastWorkoutError, startPastWorkout } from '../lib/workouts'
import { Dialog, type DialogAction } from './Dialog'

const FIELD =
  'h-12 w-full min-w-0 rounded-xl border border-line bg-bg px-3 text-base font-normal text-ink outline-none focus:border-accent'

/**
 * 지난 운동을 적기 시작하는 창. 날짜, 시작 시각, 운동 시간을 고르면 그날의 운동을 만들고
 * 운동 화면으로 넘어가 종목과 세트를 적는다. 열려 있을 때만 그린다(열 때마다 처음 값으로).
 */
export function PastWorkoutDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [today] = useState(() => toDateKey(Date.now()))
  const [date, setDate] = useState(() => toDateKey(Date.now() - 86_400_000))
  const [time, setTime] = useState('18:00')
  const [minutes, setMinutes] = useState('60')
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const start = async () => {
    if (busy) return
    const input = { date, time, minutes: Number(minutes) }
    const problem = minutes.trim() === '' ? '운동 시간을 적어 주세요.' : pastWorkoutError(input)
    if (problem !== null) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      const result = await startPastWorkout(input)
      if (result.created) {
        navigate(`/workout/${result.id}`)
        return
      }
      setActiveId(result.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '시작하지 못했습니다.')
    }
    setBusy(false)
  }

  if (activeId !== null) {
    return (
      <Dialog
        open
        title="진행 중인 운동이 있습니다"
        onClose={onClose}
        actions={[
          { label: '진행 중인 운동 열기', tone: 'primary', onClick: () => navigate(`/workout/${activeId}`) },
          { label: '닫기', onClick: onClose },
        ]}
      >
        그 운동을 마치거나 취소한 뒤에 지난 운동을 적을 수 있습니다.
      </Dialog>
    )
  }

  const actions: DialogAction[] = [
    { label: '종목 적으러 가기', tone: 'primary', onClick: () => void start() },
    { label: '취소', onClick: onClose },
  ]
  const clear = () => setError(null)

  return (
    <Dialog open title="지난 운동 기록하기" onClose={onClose} actions={actions}>
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm font-semibold text-ink">
          날짜
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              setDate(e.currentTarget.value)
              clear()
            }}
            className={FIELD}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-ink">
            시작 시각
            <input
              type="time"
              value={time}
              onChange={(e) => {
                setTime(e.currentTarget.value)
                clear()
              }}
              className={FIELD}
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm font-semibold text-ink">
            운동 시간(분)
            <input
              type="text"
              inputMode="numeric"
              enterKeyHint="done"
              autoComplete="off"
              value={minutes}
              onChange={(e) => {
                const next = e.currentTarget.value
                if (!/^\d{0,3}$/.test(next)) return
                setMinutes(next)
                clear()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void start()
              }}
              className={`${FIELD} tabular-nums`}
            />
          </label>
        </div>
      </div>
      {error !== null ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      ) : (
        <p className="mt-2 break-keep text-sm text-muted">
          그날 한 종목과 세트를 적으면 기록, 통계, 다음 추천에 그날 운동으로 들어갑니다. 운동 시간은{' '}
          {PAST_MINUTES_RANGE.min}~{PAST_MINUTES_RANGE.max}분.
        </p>
      )}
    </Dialog>
  )
}
