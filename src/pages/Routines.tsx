import { useLiveQuery } from 'dexie-react-hooks'
import { Link } from 'react-router-dom'
import { DumbbellIcon, PlusIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { RoutineStartDialog } from '../components/RoutineStartDialog'
import { formatDay } from '../lib/format'
import { loadRoutineViews, summarizeNames, type RoutineView } from '../lib/routines'
import { useGoBack } from '../lib/useGoBack'
import { useStartRoutine } from '../lib/useStartRoutine'

/** 루틴 목록. 카드를 누르면 고치고, 시작 버튼으로 바로 운동을 시작한다. */
export default function Routines() {
  const goBack = useGoBack('/')
  const views = useLiveQuery(loadRoutineViews, [])
  const { start, busy, notice, closeNotice } = useStartRoutine()

  return (
    <>
      <PageHeader title="루틴" onBack={goBack} />

      <main className="flex-1 px-3 pb-10 pt-3">
        {views === undefined ? null : views.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <p className="px-1 text-sm text-muted">루틴을 누르면 종목과 세트를 고칠 수 있습니다.</p>
            <ul className="mt-3 grid gap-2">
              {views.map((view) => (
                <RoutineCard key={view.routine.id} view={view} busy={busy} onStart={() => void start(view.routine.id)} />
              ))}
            </ul>
            <Link
              to="/routines/new"
              className="mt-3 flex h-14 w-full items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-base font-bold text-accent active:bg-surface-2"
            >
              <PlusIcon className="size-5" />새 루틴
            </Link>
          </>
        )}
      </main>

      <RoutineStartDialog notice={notice} onClose={closeNotice} />
    </>
  )
}

function RoutineCard({ view, busy, onStart }: { view: RoutineView; busy: boolean; onStart: () => void }) {
  const { routine, names, missingCount } = view
  const playable = names.length > missingCount
  return (
    <li className="flex items-center rounded-2xl border border-line bg-surface">
      <Link to={`/routines/${routine.id}`} className="min-w-0 flex-1 rounded-l-2xl py-3 pl-4 pr-2 active:bg-surface-2">
        <p className="truncate text-lg font-bold text-ink">{routine.name}</p>
        <p className="mt-0.5 truncate text-sm text-muted">{summarizeNames(names)}</p>
        <p className="mt-1 truncate text-sm tabular-nums text-muted">
          종목 {routine.items.length}개
          {' · '}
          {routine.lastUsedAt === null ? '아직 하지 않음' : `최근 ${formatDay(routine.lastUsedAt)}`}
        </p>
        {missingCount > 0 && <p className="mt-1 text-sm text-danger">지워진 종목 {missingCount}개는 건너뜁니다.</p>}
      </Link>
      <button
        type="button"
        onClick={onStart}
        disabled={busy || !playable}
        aria-label={`${routine.name} 루틴 시작`}
        className="mr-3 h-12 shrink-0 rounded-xl bg-accent px-5 text-base font-bold text-on-accent active:opacity-80 disabled:opacity-40"
      >
        시작
      </button>
    </li>
  )
}

function EmptyState() {
  return (
    <div className="mt-6 flex flex-col items-center px-4 text-center break-keep">
      <span className="flex size-16 items-center justify-center rounded-full bg-accent-soft text-accent">
        <DumbbellIcon className="size-8" />
      </span>
      <h2 className="mt-4 text-lg font-bold text-ink">아직 루틴이 없습니다</h2>
      <p className="mt-2 leading-relaxed text-muted">
        &ldquo;하체 날&rdquo;처럼 자주 하는 종목을 묶어 두면
        <br />
        홈에서 한 번에 운동을 시작할 수 있습니다.
      </p>
      <Link
        to="/routines/new"
        className="mt-6 flex h-14 w-full items-center justify-center gap-1 rounded-2xl bg-accent text-lg font-bold text-on-accent active:opacity-80"
      >
        <PlusIcon className="size-5" />새 루틴 만들기
      </Link>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        지난 운동 기록 화면의 &lsquo;루틴으로 저장&rsquo;으로도 만들 수 있습니다.
      </p>
    </div>
  )
}
