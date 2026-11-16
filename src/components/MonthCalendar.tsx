import { monthGrid, type YearMonth } from '../lib/stats'
import { BackIcon, ChevronRightIcon } from './icons'

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일']

interface MonthCalendarProps {
  month: YearMonth
  /** 운동한 날(1~31)과 그날의 운동 id */
  days: Map<number, string[]>
  /** 오늘(로컬 시간 0시 기준이 아니어도 된다) */
  today: number
  canPrev: boolean
  canNext: boolean
  onPrev: () => void
  onNext: () => void
  /** 운동한 날을 눌렀을 때 */
  onPick: (day: number, workoutIds: string[]) => void
}

/** 한 달 달력. 운동한 날은 채운 동그라미로, 하루에 두 번 이상이면 횟수를 작게 붙인다. */
export function MonthCalendar({ month, days, today, canPrev, canNext, onPrev, onNext, onPick }: MonthCalendarProps) {
  const t = new Date(today)
  const isThisMonth = t.getFullYear() === month.year && t.getMonth() === month.month
  const todayDay = isThisMonth ? t.getDate() : null
  const total = [...days.values()].reduce((n, ids) => n + ids.length, 0)
  const title = `${month.year}년 ${month.month + 1}월`

  return (
    <div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onPrev}
          disabled={!canPrev}
          aria-label="이전 달"
          className="flex size-11 items-center justify-center rounded-full text-ink active:bg-surface-2 disabled:opacity-30"
        >
          <BackIcon className="size-5" />
        </button>
        <p className="text-center" aria-live="polite">
          <span className="font-bold text-ink">{title}</span>
          <span className="ml-2 text-sm tabular-nums text-muted">{total}회</span>
        </p>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          aria-label="다음 달"
          className="flex size-11 items-center justify-center rounded-full text-ink active:bg-surface-2 disabled:opacity-30"
        >
          <ChevronRightIcon className="size-5" />
        </button>
      </div>

      <div role="table" aria-label={`${title} 운동 달력`} className="mt-1">
        <div role="row" className="grid grid-cols-7 text-center text-xs text-muted">
          {WEEK_LABELS.map((w) => (
            <span role="columnheader" key={w} aria-label={`${w}요일`} className="py-1">
              {w}
            </span>
          ))}
        </div>
        <div role="rowgroup" className="grid gap-0.5">
          {monthGrid(month).map((week, wi) => (
            <div role="row" key={wi} className="grid grid-cols-7">
              {week.map((day, di) => (
                <span role="cell" key={di} className="flex h-11 items-center justify-center">
                  {day !== null && (
                    <DayCell
                      month={month.month}
                      day={day}
                      ids={days.get(day)}
                      isToday={day === todayDay}
                      future={todayDay !== null && day > todayDay}
                      onPick={onPick}
                    />
                  )}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface DayCellProps {
  /** 0(1월)~11(12월) */
  month: number
  day: number
  ids: string[] | undefined
  isToday: boolean
  future: boolean
  onPick: (day: number, workoutIds: string[]) => void
}

function DayCell({ month, day, ids, isToday, future, onPick }: DayCellProps) {
  if (!ids) {
    return (
      <span
        aria-label={isToday ? `오늘 ${month + 1}월 ${day}일` : undefined}
        className={`flex size-9 items-center justify-center rounded-full text-[15px] tabular-nums ${
          isToday ? 'font-bold text-accent ring-2 ring-accent' : future ? 'text-muted/60' : 'text-ink'
        }`}
      >
        {day}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onPick(day, ids)}
      aria-label={`${month + 1}월 ${day}일${isToday ? '(오늘)' : ''} 운동 ${ids.length}회`}
      className={`relative flex size-9 items-center justify-center rounded-full bg-accent text-[15px] font-bold tabular-nums text-on-accent active:opacity-80 ${
        isToday ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
      }`}
    >
      {day}
      {ids.length > 1 && (
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-ink text-[10px] font-bold text-surface ring-2 ring-surface">
          {ids.length}
        </span>
      )}
    </button>
  )
}
