import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChartReadout } from '../components/charts/ChartReadout'
import { ChartTable } from '../components/charts/ChartTable'
import { TimeLineChart } from '../components/charts/TimeLineChart'
import { ChevronRightIcon } from '../components/icons'
import { NumberField } from '../components/NumberField'
import { PageHeader } from '../components/PageHeader'
import { SegmentedControl } from '../components/SegmentedControl'
import { db, type Exercise } from '../db'
import {
  bodyPartLabel,
  equipmentLabel,
  incrementFor,
  INCREMENT_RANGE,
  TARGET_REPS_RANGE,
  updateExerciseGoal,
} from '../lib/exercises'
import { formatFullDate, formatKg } from '../lib/format'
import {
  computeRecords,
  E1RM_MAX_REPS,
  formatRecordValue,
  getExerciseSessions,
  RECORD_LABELS,
  type ExerciseRecords,
  type RecordKind,
} from '../lib/history'
import {
  availableMetrics,
  exerciseSeries,
  formatDayOfYear,
  formatMetric,
  formatMonthDay,
  formatSetsSummary,
  METRIC_LABELS,
  metricValue,
  type ProgressMetric,
  type SessionPoint,
} from '../lib/stats'
import { useGoBack } from '../lib/useGoBack'

/** 처음에 보여 줄 지난 기록 수 */
const RECENT_COUNT = 8

/** 종목 상세. 개인 기록, 기록 추이 그래프, 지난 기록, 목표 횟수와 증량 단위. */
export default function ExerciseDetail() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/stats')
  const data = useLiveQuery(async () => {
    const exercise = await db.exercises.get(id)
    if (!exercise) return null
    return { exercise, sessions: await getExerciseSessions(id) }
  }, [id])

  if (data === undefined) return <PageHeader title="종목" onBack={goBack} />

  if (data === null) {
    return (
      <>
        <PageHeader title="종목" onBack={goBack} />
        <main className="flex-1 px-4 pt-6">
          <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed text-muted">
            종목을 찾을 수 없습니다.
            <br />
            지워졌거나 주소가 잘못되었습니다.
          </p>
          <Link
            to="/stats"
            replace
            className="mt-4 flex h-12 items-center justify-center rounded-xl bg-surface-2 font-semibold text-ink active:opacity-70"
          >
            통계로 가기
          </Link>
        </main>
      </>
    )
  }

  const { exercise, sessions } = data
  const points = exerciseSeries(sessions)

  return (
    <>
      <PageHeader
        title={exercise.name}
        subtitle={`${bodyPartLabel(exercise.bodyPart)} · ${equipmentLabel(exercise.equipment)}`}
        onBack={goBack}
      />
      <main className="flex-1 px-4 pb-10 pt-4">
        {points.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed text-muted">
            아직 끝낸 기록이 없습니다.
            <br />
            이 종목으로 운동을 마치면 개인 기록과
            <br />
            성장 그래프가 여기에 나타납니다.
          </p>
        ) : (
          <>
            <RecordsCard records={computeRecords(sessions)} />
            <ProgressCard key={`progress-${exercise.id}`} points={points} />
            <RecentSessions key={`recent-${exercise.id}`} points={points} />
          </>
        )}
        <GoalCard key={exercise.id} exercise={exercise} />
      </main>
    </>
  )
}

/** 개인 기록을 보여 줄 순서 */
const RECORD_ORDER: RecordKind[] = ['bestE1rm', 'maxWeight', 'sessionVolume', 'maxReps']

function RecordsCard({ records }: { records: ExerciseRecords }) {
  const rows = RECORD_ORDER.flatMap((kind) => {
    const r = records[kind]
    return r ? [r] : []
  })
  if (rows.length === 0) return null
  return (
    <section aria-labelledby="records-title">
      <h2 id="records-title" className="font-bold text-ink">
        개인 기록
      </h2>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((r) => {
          const s = r.set
          const detail =
            s && r.kind === 'bestE1rm'
              ? `${formatKg(s.weightKg ?? 0)}kg × ${s.reps}회로 계산`
              : s && r.kind === 'maxWeight'
                ? `${s.reps}회`
                : null
          return (
            <li key={r.kind}>
              <Link
                to={`/history/${r.workoutId}`}
                aria-label={`${RECORD_LABELS[r.kind]} ${formatRecordValue(r.kind, r.value)}, ${formatFullDate(r.at)}. 그날 기록 보기`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted">{RECORD_LABELS[r.kind]}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {formatMonthDay(r.at)}
                    {detail && ` · ${detail}`}
                  </p>
                </div>
                <p className="shrink-0 text-xl font-bold text-ink">{formatRecordValue(r.kind, r.value)}</p>
                <ChevronRightIcon className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 처음 기록보다 얼마나 늘었는지. "+12.5kg", "-2회", "같음" */
function formatChange(metric: ProgressMetric, diff: number): string {
  const rounded = metric === 'bestE1rm' ? Math.round(diff * 10) / 10 : diff
  if (Math.abs(rounded) < 1e-9) return '같음'
  return `${rounded > 0 ? '+' : '−'}${formatMetric(metric, Math.abs(rounded))}`
}

function ProgressCard({ points }: { points: SessionPoint[] }) {
  const metrics = availableMetrics(points)
  const [chosen, setChosen] = useState<ProgressMetric | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const metric = chosen !== null && metrics.includes(chosen) ? chosen : metrics.at(0)
  // 웜업만 한 기록뿐이면 그릴 값이 없다.
  if (metric === undefined) return null

  const series = points.flatMap((p) => {
    const v = metricValue(p, metric)
    return v === null ? [] : [{ t: p.at, v, p }]
  })
  const found = series.findIndex((s) => s.p.workoutId === picked)
  const selected = found >= 0 ? found : series.length - 1
  const sel = series[selected]
  const first = series[0]
  const label = METRIC_LABELS[metric]
  const values = series.map((s) => s.v)
  const valueText = (i: number) => `${formatFullDate(series[i].t)}, ${label} ${formatMetric(metric, series[i].v)}`

  return (
    <section aria-labelledby="progress-title" className="mt-6">
      <h2 id="progress-title" className="font-bold text-ink">
        성장 그래프
      </h2>
      <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
        {metrics.length > 1 && (
          <SegmentedControl
            label="그래프로 볼 값"
            value={metric}
            onChange={setChosen}
            options={metrics.map((m) => ({ value: m, label: METRIC_LABELS[m] }))}
          />
        )}
        <div className={metrics.length > 1 ? 'mt-3' : ''}>
          <ChartReadout
            value={formatMetric(metric, sel.v)}
            label={`${formatDayOfYear(sel.t)} · ${formatSetsSummary(sel.p.sets)}`}
            aside={
              series.length > 1 && (
                <>
                  첫 기록보다
                  <br />
                  <span className="font-semibold text-ink">
                    {selected === 0 ? '첫 기록' : formatChange(metric, sel.v - first.v)}
                  </span>
                </>
              )
            }
          />
        </div>
        <div className="mt-2">
          <TimeLineChart
            points={series.map(({ t, v }) => ({ t, v }))}
            selected={selected}
            active={found >= 0}
            onSelect={(i) => setPicked(series[i].p.workoutId)}
            name={`${label} 그래프. ${series.length}회 기록, 최저 ${formatMetric(metric, Math.min(...values))}, 최고 ${formatMetric(metric, Math.max(...values))}`}
            valueText={valueText}
            unit={metric === 'maxReps' ? '회' : 'kg'}
            integer={metric === 'maxReps'}
          />
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted">
            {metric === 'bestE1rm'
              ? `추정 1RM은 ${E1RM_MAX_REPS}회 이하 세트로 계산합니다(Epley 공식).`
              : metric === 'volume'
                ? '볼륨은 웜업을 뺀 세트의 중량×횟수 합입니다.'
                : metric === 'maxReps'
                  ? '무게 없이 한 세트 중 가장 많은 횟수입니다.'
                  : '웜업을 뺀 세트 중 가장 무거운 무게입니다.'}{' '}
            점을 누르거나 좌우로 밀어 보세요.
          </p>
          <Link
            to={`/history/${sel.p.workoutId}`}
            className="-my-1 flex shrink-0 items-center py-1 text-sm font-medium text-accent"
          >
            이날 기록
            <ChevronRightIcon className="size-4" />
          </Link>
        </div>
        <ChartTable
          caption={`${label} 기록`}
          headers={['날짜', label]}
          rows={series.map((s) => [formatFullDate(s.t), formatMetric(metric, s.v)])}
        />
      </div>
    </section>
  )
}

function RecentSessions({ points }: { points: SessionPoint[] }) {
  const [all, setAll] = useState(false)
  const recent = [...points].reverse()
  // 한두 개만 더 남으면 접지 않고 다 보여 준다.
  const foldable = recent.length > RECENT_COUNT + 2
  const shown = all || !foldable ? recent : recent.slice(0, RECENT_COUNT)
  return (
    <section aria-labelledby="recent-title" className="mt-6">
      <h2 id="recent-title" className="flex items-baseline justify-between font-bold text-ink">
        지난 기록
        <span className="text-sm font-normal tabular-nums text-muted">{points.length}회</span>
      </h2>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {shown.map((p) => (
          <li key={p.workoutId}>
            <Link
              to={`/history/${p.workoutId}`}
              className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-ink">{formatDayOfYear(p.at)}</p>
                <p className="mt-0.5 text-sm tabular-nums text-muted [overflow-wrap:anywhere]">
                  {formatSetsSummary(p.sets) || '본 세트 없음'}
                </p>
              </div>
              <ChevronRightIcon className="size-5 shrink-0 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
      {foldable && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          className="mt-2 h-11 w-full rounded-xl bg-surface-2 text-sm font-semibold text-ink active:opacity-70"
        >
          {all ? '최근 기록만 보기' : `모두 보기 (${recent.length}회)`}
        </button>
      )}
    </section>
  )
}

interface GoalFieldProps {
  label: string
  unit: string
  decimal?: boolean
  placeholder: string
  hint: string
  initial: number | null
  save: (value: number | null) => Promise<void>
}

/** 목표 값 하나. 바뀔 때마다 바로 저장하고, 범위를 벗어난 값은 저장하지 않고 칸을 벗어날 때 알려 준다. */
function GoalField({ label, unit, decimal, placeholder, hint, initial, save }: GoalFieldProps) {
  const [value, setValue] = useState<number | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(false)
  const seq = useRef(0)

  const change = (next: number | null) => {
    setValue(next)
    setLeft(false)
    const mine = ++seq.current
    save(next).then(
      () => {
        if (mine === seq.current) setError(null)
      },
      (e: unknown) => {
        if (mine === seq.current) setError(e instanceof Error ? e.message : '저장하지 못했습니다.')
      },
    )
  }

  const showError = error !== null && left
  return (
    <div onBlur={() => setLeft(true)}>
      <p className="mb-1 text-sm font-medium text-ink">{label}</p>
      <NumberField
        value={value}
        onChange={change}
        decimal={decimal}
        unit={unit}
        ariaLabel={label}
        placeholder={placeholder}
      />
      <p role={showError ? 'alert' : undefined} className={`mt-1 text-xs ${showError ? 'text-danger' : 'text-muted'}`}>
        {showError ? error : hint}
      </p>
    </div>
  )
}

function GoalCard({ exercise }: { exercise: Exercise }) {
  const defaultIncrement = incrementFor({ bodyPart: exercise.bodyPart })
  return (
    <section aria-labelledby="goal-title" className="mt-6">
      <h2 id="goal-title" className="font-bold text-ink">
        목표
      </h2>
      <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-3">
          <GoalField
            label="목표 횟수"
            unit="회"
            placeholder="정하지 않음"
            hint="비우면 정하지 않음"
            initial={exercise.targetReps ?? null}
            save={(v) => updateExerciseGoal(exercise.id, { targetReps: v })}
          />
          <GoalField
            label="증량 단위"
            unit="kg"
            decimal
            placeholder={formatKg(defaultIncrement)}
            hint={`비우면 기본 ${formatKg(defaultIncrement)}kg`}
            initial={exercise.incrementKg ?? null}
            save={(v) => updateExerciseGoal(exercise.id, { incrementKg: v })}
          />
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          다음 무게 추천은 지난번에 모든 본 세트에서 목표 횟수를 채웠으면 증량 단위만큼 무게를 올려 줍니다. 목표 횟수를
          비워 두면 루틴의 목표 횟수나 지난 기록을 기준으로 합니다.
        </p>
        <p className="mt-1 text-xs text-muted">
          바꾸면 바로 저장됩니다. 목표 횟수는 {TARGET_REPS_RANGE.min}~{TARGET_REPS_RANGE.max}회, 증량 단위는{' '}
          {INCREMENT_RANGE.min}~{INCREMENT_RANGE.max}kg로 정할 수 있습니다.
        </p>
      </div>
    </section>
  )
}
