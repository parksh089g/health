import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChartReadout } from '../components/charts/ChartReadout'
import { ChartTable } from '../components/charts/ChartTable'
import { TimeLineChart } from '../components/charts/TimeLineChart'
import { ExerciseManage } from '../components/ExerciseManage'
import { ChevronRightIcon } from '../components/icons'
import { NumberField } from '../components/NumberField'
import { PageHeader } from '../components/PageHeader'
import { SegmentedControl } from '../components/SegmentedControl'
import { db, type Exercise } from '../db'
import {
  EXERCISE_NOTE_MAX,
  exerciseKindText,
  incrementFor,
  INCREMENT_RANGE,
  restoreExercise,
  targetRange,
  updateExerciseGoal,
  updateExerciseNote,
  updateExerciseRest,
} from '../lib/exercises'
import { formatFullDate, formatKg } from '../lib/format'
import {
  computeRecords,
  E1RM_MAX_REPS,
  formatRecordValue,
  getExerciseSessions,
  recordLabel,
  type ExerciseRecords,
  type RecordKind,
} from '../lib/history'
import { formatWeight, isTimed, measureOf, targetLabel, usesAddedWeight } from '../lib/measure'
import { TIME_STEP_SECONDS } from '../lib/recommend'
import {
  availableMetrics,
  exerciseSeries,
  formatDayOfYear,
  formatMetric,
  formatMonthDay,
  formatSetsSummary,
  metricLabel,
  metricValue,
  type ProgressMetric,
  type SessionPoint,
} from '../lib/stats'
import { DEFAULT_REST_SECONDS, getRestSeconds, REST_OPTIONS, REST_RANGE } from '../lib/settings'
import { useGoBack } from '../lib/useGoBack'

/** 처음에 보여 줄 지난 기록 수 */
const RECENT_COUNT = 8

/** 종목 상세. 개인 기록, 기록 추이 그래프, 지난 기록, 그리고 종목 설정(메모, 목표, 휴식 시간, 고치기와 숨기기). */
export default function ExerciseDetail() {
  const { id = '' } = useParams()
  const goBack = useGoBack('/stats')
  // 종목과 기록을 따로 구독한다. 메모나 휴식 시간을 고칠 때마다 지난 기록을 전부 다시 읽지 않도록.
  const exercise = useLiveQuery(async () => (await db.exercises.get(id)) ?? null, [id])
  const sessions = useLiveQuery(() => getExerciseSessions(id), [id])
  const defaultRest = useLiveQuery(getRestSeconds, []) ?? DEFAULT_REST_SECONDS
  const settingsRef = useRef<HTMLDivElement>(null)

  if (exercise === undefined || sessions === undefined) return <PageHeader title="종목" onBack={goBack} />

  if (exercise === null) {
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

  const points = exerciseSeries(sessions)
  const kind = exerciseKindText(exercise)
  const subtitle = exercise.isCustom ? `${kind} · 내 종목` : kind

  return (
    <>
      <PageHeader
        title={exercise.name}
        subtitle={subtitle}
        onBack={goBack}
        right={
          // 기록이 길면 설정이 한참 아래에 있어서, 바로 내려가는 버튼을 둔다.
          points.length > 0 && (
            <button
              type="button"
              onClick={() => settingsRef.current?.scrollIntoView({ block: 'start' })}
              className="mr-1 h-11 shrink-0 rounded-xl px-3 text-[15px] font-semibold text-accent active:bg-surface-2"
            >
              종목 설정
            </button>
          )
        }
      />
      <main className="flex-1 px-4 pb-10 pt-4">
        {exercise.archived && (
          <div className="mb-4 rounded-2xl border border-line bg-surface-2 p-4">
            <p className="font-bold text-ink">숨긴 종목</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              종목 선택에 나오지 않습니다. 지난 기록과 통계, 루틴에는 그대로 남아 있습니다.
            </p>
            <button
              type="button"
              onClick={() => void restoreExercise(exercise.id)}
              className="mt-3 h-11 w-full rounded-xl bg-accent font-semibold text-on-accent active:opacity-80"
            >
              다시 보이기
            </button>
          </div>
        )}
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
            <RecordsCard records={computeRecords(sessions, exercise)} exercise={exercise} />
            <ProgressCard key={`progress-${exercise.id}`} points={points} exercise={exercise} />
            <RecentSessions key={`recent-${exercise.id}`} points={points} exercise={exercise} />
          </>
        )}
        {/* 머리줄(sticky)에 가리지 않게 여백을 두고 멈춘다. */}
        <div ref={settingsRef} className="scroll-mt-[calc(4rem+env(safe-area-inset-top))]">
          <NoteCard key={`note-${exercise.id}`} exercise={exercise} />
          {/* 횟수와 시간을 바꾸면 목표 칸의 뜻과 값이 달라지므로 새로 그린다. */}
          <GoalCard key={`goal-${exercise.id}-${measureOf(exercise)}`} exercise={exercise} />
          <RestCard key={`rest-${exercise.id}`} exercise={exercise} defaultSeconds={defaultRest} />
          <section aria-labelledby="manage-title" className="mt-6">
            <h2 id="manage-title" className="font-bold text-ink">
              종목 관리
            </h2>
            <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
              <ExerciseManage
                key={exercise.id}
                exercise={exercise}
                onRemoved={(result) => {
                  // 지운 종목은 더 볼 것이 없으니 돌아간다. 숨긴 종목은 이 화면에서 바로 되돌릴 수 있게 남는다.
                  if (result === 'deleted') goBack()
                }}
              />
            </div>
          </section>
        </div>
      </main>
    </>
  )
}

/** 개인 기록을 보여 줄 순서 */
const RECORD_ORDER: RecordKind[] = ['bestE1rm', 'maxWeight', 'sessionVolume', 'maxReps', 'maxDuration']

function RecordsCard({ records, exercise }: { records: ExerciseRecords; exercise: Exercise }) {
  const addedWeight = usesAddedWeight(exercise)
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
                : // 무게를 달고 버틴 기록이면 그 무게를 함께 보여 준다.
                  s && r.kind === 'maxDuration' && (s.weightKg ?? 0) > 0
                  ? formatWeight(s.weightKg ?? 0, addedWeight)
                  : null
          const label = recordLabel(r.kind, exercise)
          const value = formatRecordValue(r.kind, r.value, exercise)
          return (
            <li key={r.kind}>
              <Link
                to={`/history/${r.workoutId}`}
                aria-label={`${label} ${value}, ${formatFullDate(r.at)}. 그날 기록 보기`}
                className="flex min-h-16 items-center gap-3 px-4 py-3 active:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted">{label}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {formatMonthDay(r.at)}
                    {detail && ` · ${detail}`}
                  </p>
                </div>
                <p className="shrink-0 text-xl font-bold text-ink">{value}</p>
                <ChevronRightIcon className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 처음 기록보다 얼마나 늘었는지. "+12.5kg", "-2회", "+15초", "같음" */
function formatChange(metric: ProgressMetric, diff: number): string {
  const rounded = metric === 'bestE1rm' ? Math.round(diff * 10) / 10 : diff
  if (Math.abs(rounded) < 1e-9) return '같음'
  return `${rounded > 0 ? '+' : '−'}${formatMetric(metric, Math.abs(rounded))}`
}

/** 그래프 아래에 붙이는, 그 값을 어떻게 셌는지에 대한 설명 */
function metricHint(metric: ProgressMetric, addedWeight: boolean): string {
  if (metric === 'bestE1rm') return `추정 1RM은 ${E1RM_MAX_REPS}회 이하 세트로 계산합니다(Epley 공식).`
  if (metric === 'volume') return '볼륨은 웜업을 뺀 세트의 중량×횟수 합입니다.'
  if (metric === 'maxReps') return '무게 없이 한 세트 중 가장 많은 횟수입니다.'
  if (metric === 'maxDuration') return '웜업을 뺀 세트 중 가장 오래 버틴 시간입니다.'
  if (metric === 'totalDuration') return '웜업을 뺀 세트의 시간을 모두 더한 값입니다.'
  return addedWeight ? '웜업을 뺀 세트 중 가장 무거운 추가 무게입니다.' : '웜업을 뺀 세트 중 가장 무거운 무게입니다.'
}

function ProgressCard({ points, exercise }: { points: SessionPoint[]; exercise: Exercise }) {
  const addedWeight = usesAddedWeight(exercise)
  const metrics = availableMetrics(points, exercise)
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
  const label = metricLabel(metric, exercise)
  const values = series.map((s) => s.v)
  const format = (v: number) => formatMetric(metric, v, exercise)
  const valueText = (i: number) => `${formatFullDate(series[i].t)}, ${label} ${format(series[i].v)}`
  const unit = metric === 'maxReps' ? '회' : metric === 'maxDuration' || metric === 'totalDuration' ? '초' : 'kg'

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
            options={metrics.map((m) => ({ value: m, label: metricLabel(m, exercise) }))}
          />
        )}
        <div className={metrics.length > 1 ? 'mt-3' : ''}>
          <ChartReadout
            value={format(sel.v)}
            label={`${formatDayOfYear(sel.t)} · ${formatSetsSummary(sel.p.sets, { addedWeight })}`}
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
            name={`${label} 그래프. ${series.length}회 기록, 최저 ${format(Math.min(...values))}, 최고 ${format(Math.max(...values))}`}
            valueText={valueText}
            unit={unit}
            integer={unit !== 'kg'}
          />
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="text-xs leading-relaxed text-muted">
            {metricHint(metric, addedWeight)} 점을 누르거나 좌우로 밀어 보세요.
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
          rows={series.map((s) => [formatFullDate(s.t), format(s.v)])}
        />
      </div>
    </section>
  )
}

function RecentSessions({ points, exercise }: { points: SessionPoint[]; exercise: Exercise }) {
  const [all, setAll] = useState(false)
  const addedWeight = usesAddedWeight(exercise)
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
                  {formatSetsSummary(p.sets, { addedWeight }) || '본 세트 없음'}
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

/**
 * 바뀔 때마다 바로 저장하는 값 하나. 범위를 벗어난 값은 저장되지 않고, 칸을 벗어날 때(left) 오류를 알려 준다.
 * 연달아 고치면 마지막 저장의 결과만 반영한다.
 */
function useAutoSave<T>(initial: T, save: (value: T) => Promise<void>) {
  const [value, setValue] = useState<T>(initial)
  const [error, setError] = useState<string | null>(null)
  const [left, setLeft] = useState(false)
  const seq = useRef(0)

  const change = (next: T, opts: { left?: boolean } = {}) => {
    setValue(next)
    setLeft(opts.left ?? false)
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

  return { value, change, error: left ? error : null, onBlur: () => setLeft(true) }
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
  const { value, change, error, onBlur } = useAutoSave(initial, save)
  return (
    <div onBlur={onBlur}>
      <p className="mb-1 text-sm font-medium text-ink">{label}</p>
      <NumberField
        value={value}
        onChange={change}
        decimal={decimal}
        unit={unit}
        ariaLabel={label}
        placeholder={placeholder}
      />
      <p role={error ? 'alert' : undefined} className={`mt-1 text-xs ${error ? 'text-danger' : 'text-muted'}`}>
        {error ?? hint}
      </p>
    </div>
  )
}

/** 몇 분 몇 초인지. 90 → "1분 30초", 180 → "3분", 45 → "45초" */
function formatMinSec(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const sec = seconds % 60
  if (m === 0) return `${sec}초`
  return sec === 0 ? `${m}분` : `${m}분 ${sec}초`
}

/** 종목별 휴식 시간. 자주 쓰는 길이는 눌러서 고르고, 그 밖의 길이는 초로 직접 적는다. 바로 저장된다. */
function RestCard({ exercise, defaultSeconds }: { exercise: Exercise; defaultSeconds: number }) {
  const { value, change, error, onBlur } = useAutoSave<number | null>(exercise.restSeconds ?? null, (v) =>
    updateExerciseRest(exercise.id, v),
  )
  const chip = (on: boolean) =>
    `h-11 min-w-0 rounded-xl text-[15px] font-semibold tabular-nums active:opacity-70 ${
      on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
    }`
  return (
    <section aria-labelledby="rest-title" className="mt-6">
      <h2 id="rest-title" className="font-bold text-ink">
        휴식 시간
      </h2>
      <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="이 종목의 휴식 시간">
          <button
            type="button"
            aria-pressed={value === null}
            onClick={() => change(null, { left: true })}
            className={chip(value === null)}
          >
            기본
          </button>
          {REST_OPTIONS.map((sec) => (
            <button
              key={sec}
              type="button"
              aria-pressed={value === sec}
              onClick={() => change(sec, { left: true })}
              className={chip(value === sec)}
            >
              {sec}초
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 items-center gap-3" onBlur={onBlur}>
          <NumberField
            value={value}
            onChange={change}
            unit="초"
            ariaLabel="휴식 시간 직접 입력"
            placeholder={`기본 ${defaultSeconds}`}
          />
          <p role={error ? 'alert' : undefined} className={`text-sm ${error ? 'text-danger' : 'text-muted'}`}>
            {error ?? (value === null ? `직접 입력 · 기본 ${formatMinSec(defaultSeconds)}` : formatMinSec(value))}
          </p>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          이 종목의 세트를 완료하면 이 시간으로 휴식 타이머가 시작됩니다. 기본으로 두면 설정의 휴식 시간 기본값(
          {defaultSeconds}초)을 씁니다.
        </p>
        <p className="mt-1 text-xs text-muted">
          바꾸면 바로 저장됩니다. {REST_RANGE.min}~{REST_RANGE.max}초로 정할 수 있습니다.
        </p>
      </div>
    </section>
  )
}

/** 글을 멈추고 이만큼 지나면 메모를 저장한다. */
const NOTE_SAVE_DELAY_MS = 600

/**
 * 종목 메모(시트 높이, 그립 같은 세팅). 운동 중 종목 카드에 보인다.
 * 글자를 칠 때마다 저장하면 화면 전체가 다시 그려지므로, 잠깐 멈췄을 때와 칸이나 화면을 벗어날 때 저장한다.
 */
function NoteCard({ exercise }: { exercise: Exercise }) {
  const [text, setText] = useState(exercise.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(text)
  const saved = useRef(text.trim())
  const timer = useRef<number | null>(null)
  const exerciseId = exercise.id

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const next = latest.current.trim()
    if (next === saved.current) return
    saved.current = next
    updateExerciseNote(exerciseId, next).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : '저장하지 못했습니다.'),
    )
  }, [exerciseId])

  // 다 치기 전에 화면을 떠나도 메모가 남게 한다.
  useEffect(() => flush, [flush])

  const change = (next: string) => {
    setText(next)
    latest.current = next
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, NOTE_SAVE_DELAY_MS)
  }

  return (
    <section aria-labelledby="note-title" className="mt-6">
      <h2 id="note-title" className="flex items-baseline justify-between font-bold text-ink">
        메모
        <span className="text-sm font-normal tabular-nums text-muted">
          {text.length}/{EXERCISE_NOTE_MAX}
        </span>
      </h2>
      <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
        <textarea
          value={text}
          onChange={(e) => change(e.currentTarget.value)}
          onBlur={flush}
          maxLength={EXERCISE_NOTE_MAX}
          rows={3}
          aria-label="종목 메모"
          placeholder="예: 시트 높이 4칸, 와이드 그립"
          className="block w-full resize-none rounded-xl border border-line bg-bg px-3 py-2.5 leading-relaxed text-ink outline-none placeholder:text-muted/60 focus:border-accent"
        />
        <p role={error ? 'alert' : undefined} className={`mt-2 text-xs ${error ? 'text-danger' : 'text-muted'}`}>
          {error ?? '시트 높이나 그립 같은 세팅을 적어 두면 운동 중 이 종목 카드에 보입니다. 적으면 바로 저장됩니다.'}
        </p>
      </div>
    </section>
  )
}

function GoalCard({ exercise }: { exercise: Exercise }) {
  const defaultIncrement = incrementFor({ bodyPart: exercise.bodyPart })
  // 시간 종목은 목표 칸(targetReps)을 목표 시간(초)으로 쓰고, 무게를 올리는 추천이 없어 증량 단위를 두지 않는다.
  const timed = isTimed(exercise)
  const addedWeight = usesAddedWeight(exercise)
  const range = targetRange(exercise)
  const unit = timed ? '초' : '회'
  return (
    <section aria-labelledby="goal-title" className="mt-6">
      <h2 id="goal-title" className="font-bold text-ink">
        목표
      </h2>
      <div className="mt-2 rounded-2xl border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-3">
          <GoalField
            label={targetLabel(exercise)}
            unit={unit}
            placeholder="정하지 않음"
            hint="비우면 정하지 않음"
            initial={exercise.targetReps ?? null}
            save={(v) => updateExerciseGoal(exercise.id, { targetReps: v })}
          />
          {!timed && (
            <GoalField
              label="증량 단위"
              unit="kg"
              decimal
              placeholder={formatKg(defaultIncrement)}
              hint={`비우면 기본 ${formatKg(defaultIncrement)}kg`}
              initial={exercise.incrementKg ?? null}
              save={(v) => updateExerciseGoal(exercise.id, { incrementKg: v })}
            />
          )}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {timed
            ? `다음 추천은 지난번에 가장 오래 버틴 시간보다 ${TIME_STEP_SECONDS}초 더를 보여 줍니다. 목표 시간을 못 채운 세트가 있었으면 목표 시간을 다시 추천합니다. 루틴에 목표 시간이 있으면 그것을 먼저 씁니다.`
            : addedWeight
              ? '맨몸으로 했으면 지난번 최고 횟수보다 1회 더를 추천합니다. 추가 무게를 달았으면 모든 본 세트에서 목표 횟수를 채웠을 때 증량 단위만큼 추가 무게를 올려 줍니다. 루틴에 목표 횟수가 있으면 그것을 먼저 쓰고, 둘 다 없으면 지난 기록의 횟수를 기준으로 합니다.'
              : '다음 무게 추천은 지난번에 모든 본 세트에서 목표 횟수를 채웠으면 증량 단위만큼 무게를 올려 줍니다. 루틴에 목표 횟수가 있으면 그것을 먼저 쓰고, 둘 다 없으면 지난 기록의 횟수를 기준으로 합니다.'}
        </p>
        <p className="mt-1 text-xs text-muted">
          바꾸면 바로 저장됩니다. {targetLabel(exercise)}
          {timed ? '은' : '는'} {range.min}~{range.max}
          {unit}
          {timed ? '로 정할 수 있습니다.' : `, 증량 단위는 ${INCREMENT_RANGE.min}~${INCREMENT_RANGE.max}kg로 정할 수 있습니다.`}
        </p>
      </div>
    </section>
  )
}
