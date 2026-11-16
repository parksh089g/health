import { useLiveQuery } from 'dexie-react-hooks'
import { WorkoutSummaryRow } from '../components/WorkoutSummaryRow'
import { formatMonth } from '../lib/format'
import { loadWorkoutSummaries, type WorkoutSummary } from '../lib/workouts'

/** 기록 목록. 끝난 운동을 최근 것부터 달별로 묶어 보여 준다. */
export default function History() {
  const summaries = useLiveQuery(loadWorkoutSummaries, [])

  const months: { month: string; rows: WorkoutSummary[] }[] = []
  for (const s of summaries ?? []) {
    const month = formatMonth(s.workout.startedAt)
    const last = months.at(-1)
    if (last && last.month === month) last.rows.push(s)
    else months.push({ month, rows: [s] })
  }

  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-bold text-ink">기록</h1>

      {summaries !== undefined && summaries.length === 0 && (
        <p className="mt-5 rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed text-muted">
          아직 기록이 없습니다.
          <br />
          홈에서 운동을 시작해 보세요.
        </p>
      )}

      {months.map(({ month, rows }) => (
        <section key={month} className="mt-5" aria-label={month}>
          <h2 className="flex items-baseline justify-between text-sm font-semibold text-muted">
            {month}
            <span className="font-normal tabular-nums">{rows.length}회</span>
          </h2>
          <div className="mt-2 grid gap-2">
            {rows.map((s) => (
              <WorkoutSummaryRow key={s.workout.id} summary={s} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
