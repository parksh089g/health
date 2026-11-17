import { Link } from 'react-router-dom'
import { formatDay, formatDuration, formatVolume } from '../lib/format'
import type { WorkoutSummary } from '../lib/workouts'
import { ChevronRightIcon } from './icons'

/** 기록 목록의 한 줄. 누르면 그 운동의 상세로 간다. */
export function WorkoutSummaryRow({ summary }: { summary: WorkoutSummary }) {
  const { workout, exerciseNames, setCount, volume } = summary
  const names =
    exerciseNames.length <= 3
      ? exerciseNames.join(', ')
      : `${exerciseNames.slice(0, 3).join(', ')} 외 ${exerciseNames.length - 3}개`
  const duration = (workout.endedAt ?? workout.startedAt) - workout.startedAt

  return (
    <Link
      to={`/history/${workout.id}`}
      className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-surface-2"
    >
      <div className="min-w-0 flex-1">
        <p className="font-bold text-ink">{formatDay(workout.startedAt)}</p>
        <p className="mt-0.5 truncate text-sm text-muted">{names || '종목 없음'}</p>
        <p className="mt-1 text-sm tabular-nums text-muted">
          {formatDuration(duration)} · {setCount}세트
          {/* 유산소나 맨몸 운동만 한 날은 볼륨이 0이라 적지 않는다. */}
          {volume > 0 && <> · {formatVolume(volume)}kg</>}
        </p>
      </div>
      <ChevronRightIcon className="size-5 shrink-0 text-muted" />
    </Link>
  )
}
