import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { PlusIcon } from '../components/icons'
import { RoutineStartDialog } from '../components/RoutineStartDialog'
import { WorkoutSummaryRow } from '../components/WorkoutSummaryRow'
import { formatClock, formatDay } from '../lib/format'
import { loadRoutineViews, summarizeNames, type RoutineView } from '../lib/routines'
import { useNow } from '../lib/useNow'
import { useStartRoutine } from '../lib/useStartRoutine'
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
    const routines = await loadRoutineViews()
    return { activeDetail, summaries, routines }
  }, [])
  const routineStart = useStartRoutine()

  const start = async () => {
    const id = await startWorkout()
    navigate(`/workout/${id}`)
  }

  const active = data?.activeDetail ?? null
  const summaries = data?.summaries ?? []
  const routines = data?.routines ?? []
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

      {data !== undefined && (
        <RoutinesSection
          routines={routines}
          busy={routineStart.busy}
          onStart={(id) => void routineStart.start(id)}
        />
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

      <RoutineStartDialog notice={routineStart.notice} onClose={routineStart.closeNotice} />
    </div>
  )
}

/** 홈에 보이는 루틴 수 */
const HOME_ROUTINE_COUNT = 3

/** 최근에 쓴 루틴 몇 개를 바로 시작할 수 있게 보여 준다. 루틴이 없으면 만들기 링크만 둔다. */
function RoutinesSection({
  routines,
  busy,
  onStart,
}: {
  routines: RoutineView[]
  busy: boolean
  onStart: (routineId: string) => void
}) {
  if (routines.length === 0) {
    return (
      <section className="mt-3" aria-label="루틴">
        <Link
          to="/routines/new"
          className="flex h-12 items-center gap-2 rounded-2xl border border-dashed border-line px-4 active:bg-surface-2"
        >
          <PlusIcon className="size-5 shrink-0 text-accent" />
          <span className="shrink-0 font-semibold text-accent">루틴 만들기</span>
          <span className="min-w-0 truncate text-sm text-muted">종목 묶음을 한 번에 시작</span>
        </Link>
      </section>
    )
  }

  return (
    <section className="mt-6" aria-label="루틴">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-ink">루틴</h2>
        <Link to="/routines" aria-label="루틴 전체 보기" className="py-1 text-sm font-medium text-accent">
          전체 보기
        </Link>
      </div>
      <ul className="mt-3 grid gap-2">
        {routines.slice(0, HOME_ROUTINE_COUNT).map(({ routine, names, missingCount }) => (
          <li key={routine.id} className="flex items-center rounded-2xl border border-line bg-surface">
            <Link
              to={`/routines/${routine.id}`}
              className="min-w-0 flex-1 rounded-l-2xl py-3 pl-4 pr-2 active:bg-surface-2"
            >
              <p className="truncate font-bold text-ink">{routine.name}</p>
              <p className="mt-0.5 truncate text-sm text-muted">{summarizeNames(names)}</p>
            </Link>
            <button
              type="button"
              onClick={() => onStart(routine.id)}
              disabled={busy || names.length === missingCount}
              aria-label={`${routine.name} 루틴 시작`}
              className="mr-3 h-11 shrink-0 rounded-xl bg-accent-soft px-4 text-[15px] font-bold text-accent active:opacity-70 disabled:opacity-40"
            >
              시작
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
