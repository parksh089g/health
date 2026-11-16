import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { WorkoutSummaryRow } from '../components/WorkoutSummaryRow'
import { formatClock, formatDay } from '../lib/format'
import { useNow } from '../lib/useNow'
import {
  countThisWeek,
  daysWorkedThisWeek,
  getActiveWorkout,
  loadWorkoutDetail,
  loadWorkoutSummaries,
  startWorkout,
} from '../lib/workouts'

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일']

export default function Home() {
  const navigate = useNavigate()
  const now = useNow(1000)
  const data = useLiveQuery(async () => {
    const active = await getActiveWorkout()
    const activeDetail = active ? await loadWorkoutDetail(active.id) : null
    const summaries = await loadWorkoutSummaries()
    return { activeDetail, summaries }
  }, [])

  const start = async () => {
    const id = await startWorkout()
    navigate(`/workout/${id}`)
  }

  const active = data?.activeDetail ?? null
  const summaries = data?.summaries ?? []
  const finished = summaries.map((s) => s.workout)
  const weekDays = daysWorkedThisWeek(finished, now)
  const todayIndex = (new Date(now).getDay() + 6) % 7

  return (
    <div className="px-4 pt-6">
      <p className="text-sm text-muted">{formatDay(now)}</p>
      <h1 className="text-2xl font-bold text-ink">헬스 기록</h1>

      {data === undefined ? (
        <div className="mt-5 h-16" />
      ) : active ? (
        <section className="mt-5 rounded-2xl border border-accent bg-accent-soft p-4" aria-label="진행 중인 운동">
          <p className="text-sm font-semibold text-accent">진행 중인 운동</p>
          <p className="mt-1 text-4xl font-bold tabular-nums text-ink">
            {formatClock(now - active.workout.startedAt)}
          </p>
          <p className="mt-1 text-sm text-muted">
            종목 {active.items.length}개 · 완료한 세트{' '}
            {active.items.reduce((n, item) => n + item.sets.filter((s) => s.isDone).length, 0)}개
          </p>
          <button
            type="button"
            onClick={() => navigate(`/workout/${active.workout.id}`)}
            className="mt-4 h-14 w-full rounded-2xl bg-accent text-lg font-bold text-on-accent active:opacity-80"
          >
            이어서 하기
          </button>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="mt-5 h-16 w-full rounded-2xl bg-accent text-xl font-bold text-on-accent shadow-sm active:opacity-80"
        >
          운동 시작
        </button>
      )}

      <section className="mt-6 rounded-2xl border border-line bg-surface p-4" aria-label="이번 주 운동">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-ink">이번 주 운동</h2>
          <p className="text-ink">
            <span className="text-2xl font-bold tabular-nums">{countThisWeek(finished, now)}</span>
            <span className="ml-0.5 text-sm text-muted">회</span>
          </p>
        </div>
        <ol className="mt-3 grid grid-cols-7 gap-1 text-center">
          {WEEK_LABELS.map((label, i) => (
            <li key={label} className="flex flex-col items-center gap-1">
              <span
                aria-label={`${label}요일 ${weekDays[i] ? '운동함' : '운동 안 함'}`}
                className={`size-8 rounded-full ${weekDays[i] ? 'bg-accent' : 'bg-surface-2'} ${
                  i === todayIndex ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : ''
                }`}
              />
              <span className={`text-xs ${i === todayIndex ? 'font-bold text-ink' : 'text-muted'}`}>{label}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6" aria-label="최근 운동">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-ink">최근 운동</h2>
          {summaries.length > 0 && (
            <Link to="/history" className="py-1 text-sm font-medium text-accent">
              전체 보기
            </Link>
          )}
        </div>
        {summaries.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed text-muted">
            아직 기록이 없습니다.
            <br />
            운동을 시작하면 여기에 쌓입니다.
          </p>
        ) : (
          <div className="mt-3 grid gap-2">
            {summaries.slice(0, 3).map((s) => (
              <WorkoutSummaryRow key={s.workout.id} summary={s} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
