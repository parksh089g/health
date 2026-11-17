import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AiReviewCard } from '../components/AiReviewCard'
import { BodyWeightCard } from '../components/BodyWeightCard'
import { ChartReadout } from '../components/charts/ChartReadout'
import { ChartTable } from '../components/charts/ChartTable'
import { ColumnChart } from '../components/charts/ColumnChart'
import { RankedBars } from '../components/charts/RankedBars'
import { shortDate } from '../components/charts/scale'
import { Dialog } from '../components/Dialog'
import { ChevronRightIcon } from '../components/icons'
import { MonthCalendar } from '../components/MonthCalendar'
import { SegmentedControl } from '../components/SegmentedControl'
import { bodyPartLabel } from '../lib/exercises'
import { formatTime, formatVolume } from '../lib/format'
import { recordLabel } from '../lib/history'
import { formatCardioTime } from '../lib/measure'
import {
  addMonths,
  bodyPartSets,
  countInMonth,
  exerciseOverviews,
  formatMetric,
  formatMonthDay,
  formatWeekRange,
  hasCardioSessions,
  lastDays,
  loadStatsData,
  monthOf,
  sameMonth,
  weeklyCardio,
  weeklyTotals,
  workoutDaysInMonth,
  type StatsData,
  type WeekTotal,
  type YearMonth,
} from '../lib/stats'
import { useNow } from '../lib/useNow'

const WEEKS = 12
const BODY_PART_DAYS = 28

/** 통계 탭. 이번 달과 이번 주 요약, 체중, 주별 운동 횟수와 볼륨, 유산소 시간, 부위별 세트, 운동 달력, 종목 목록. */
export default function Stats() {
  const now = useNow(60_000)
  const data = useLiveQuery(loadStatsData, [])

  return (
    <div className="px-4 pt-6">
      <h1 className="text-2xl font-bold text-ink">통계</h1>
      {data !== undefined &&
        (data.workouts.length === 0 ? (
          <>
            <p className="mt-5 rounded-2xl border border-dashed border-line p-5 text-center text-sm leading-relaxed text-muted">
              아직 끝낸 운동이 없습니다.
              <br />
              운동을 마치면 주별 기록, 부위별 세트, 운동 달력과
              <br />
              종목별 성장 그래프가 여기에 나타납니다.
            </p>
            {/* 체중은 운동 기록이 없어도 적을 수 있다. */}
            <BodyWeightCard now={now} />
          </>
        ) : (
          <StatsBody data={data} now={now} />
        ))}
    </div>
  )
}

function StatsBody({ data, now }: { data: StatsData; now: number }) {
  const weeks = weeklyTotals(data.workouts, data.sessions, { weeks: WEEKS, now, exercises: data.exercises })
  const thisMonth = monthOf(now)

  return (
    <>
      <Overview data={data} weeks={weeks} thisMonth={thisMonth} />
      <AiReviewCard />
      <BodyWeightCard now={now} />
      <WeeklyCard weeks={weeks} />
      <CardioCard data={data} now={now} />
      <BodyPartCard data={data} now={now} />
      <CalendarCard data={data} now={now} />
      <ExerciseList data={data} />
    </>
  )
}

function Overview({ data, weeks, thisMonth }: { data: StatsData; weeks: WeekTotal[]; thisMonth: YearMonth }) {
  const monthCount = countInMonth(data.workouts, thisMonth)
  const lastMonthCount = countInMonth(data.workouts, addMonths(thisMonth, -1))
  const thisWeek = weeks[weeks.length - 1]
  const lastWeek = weeks[weeks.length - 2]
  const ratio = lastWeek.volume > 0 ? Math.round((thisWeek.volume / lastWeek.volume) * 100) : null

  return (
    <section aria-label="요약" className="mt-5 grid grid-cols-2 gap-2">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm text-muted">{thisMonth.month + 1}월 운동</h2>
        <p className="mt-1 text-ink">
          <span className="text-2xl font-bold">{monthCount}</span>
          <span className="ml-0.5 text-sm text-muted">회</span>
        </p>
        <p className="mt-1 text-xs text-muted">지난달 {lastMonthCount}회</p>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <h2 className="text-sm text-muted">이번 주 볼륨</h2>
        <p className="mt-1 text-ink">
          <span className="text-2xl font-bold">{formatVolume(thisWeek.volume)}</span>
          <span className="ml-0.5 text-sm text-muted">kg</span>
        </p>
        {ratio === null ? (
          <p className="mt-1 text-xs text-muted">지난주 기록 없음</p>
        ) : (
          <>
            {/* 지난주 볼륨을 다 채운 만큼 막대가 찬다. */}
            <div className="mt-2 flex items-center gap-2" aria-hidden="true">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent-soft">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, ratio)}%` }} />
              </span>
              <span className="text-xs font-semibold tabular-nums text-ink">{ratio}%</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              지난주 {formatVolume(lastWeek.volume)}kg
              <span className="sr-only">의 {ratio}%</span>
            </p>
          </>
        )}
      </div>
    </section>
  )
}

/** 그 주를 부르는 이름. 이번 주와 지난주는 앞에 그렇게 붙인다. */
function weekName(weeks: { start: number }[], i: number): string {
  const last = weeks.length - 1
  const range = formatWeekRange(weeks[i].start)
  return i === last ? `이번 주 · ${range}` : i === last - 1 ? `지난주 · ${range}` : range
}

type WeeklyMetric = 'workouts' | 'volume'

function WeeklyCard({ weeks }: { weeks: WeekTotal[] }) {
  const [metric, setMetric] = useState<WeeklyMetric>('workouts')
  const [picked, setPicked] = useState<number | null>(null)
  const last = weeks.length - 1
  const found = weeks.findIndex((w) => w.start === picked)
  const selected = found >= 0 ? found : last

  const values = weeks.map((w) => (metric === 'workouts' ? w.workouts : w.volume))
  const format = (v: number) => (metric === 'workouts' ? `${v}회` : `${formatVolume(v)}kg`)
  const average = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
  const metricName = metric === 'workouts' ? '운동 횟수' : '볼륨'

  return (
    <section aria-labelledby="weekly-title" className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="weekly-title" className="font-bold text-ink">
            주별 기록
          </h2>
          <p className="text-xs text-muted">최근 {WEEKS}주</p>
        </div>
        <SegmentedControl
          label="주별 기록 보기"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'workouts', label: '운동 횟수' },
            { value: 'volume', label: '볼륨' },
          ]}
        />
      </div>

      <div className="mt-3">
        <ChartReadout
          value={format(values[selected])}
          label={weekName(weeks, selected)}
          aside={
            <>
              {WEEKS}주 평균
              <br />
              <span className="font-semibold text-ink">
                {metric === 'workouts'
                  ? `${(Math.round(average * 10) / 10).toLocaleString('ko-KR')}회`
                  : `${formatVolume(average)}kg`}
              </span>
            </>
          }
        />
      </div>

      <div className="mt-2">
        {values.every((v) => v === 0) ? (
          <p className="flex h-40 items-center justify-center text-sm text-muted">
            최근 {WEEKS}주에는 끝낸 운동이 없습니다.
          </p>
        ) : (
          <ColumnChart
            values={values}
            labels={weeks.map((w) => shortDate(w.start))}
            strongLabel={last}
            selected={selected}
            onSelect={(i) => setPicked(weeks[i].start)}
            name={`주별 ${metricName} 그래프`}
            valueText={(i) => `${weekName(weeks, i)}, ${format(values[i])}`}
            unit={metric === 'workouts' ? '회' : 'kg'}
            integer={metric === 'workouts'}
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">막대를 누르면 그 주의 값을 볼 수 있습니다. 날짜는 그 주의 월요일입니다.</p>
      <ChartTable
        caption={`최근 ${WEEKS}주 주별 ${metricName}`}
        headers={['주', metricName]}
        rows={weeks.map((w, i) => [formatWeekRange(w.start), format(values[i])])}
      />
    </section>
  )
}

/**
 * 유산소. 이번 주에 한 시간과 최근 12주의 주별 시간(분). 유산소 기록이 하나도 없으면 그리지 않는다.
 * 유산소는 볼륨과 부위별 세트에 들어가지 않아서 따로 보여 준다.
 */
function CardioCard({ data, now }: { data: StatsData; now: number }) {
  const [picked, setPicked] = useState<number | null>(null)
  if (!hasCardioSessions(data.sessions, data.exercises)) return null

  const weeks = weeklyCardio(data.sessions, data.exercises, { weeks: WEEKS, now })
  const last = weeks.length - 1
  const found = weeks.findIndex((w) => w.start === picked)
  const selected = found >= 0 ? found : last
  // 그래프는 분으로 그린다(1분이 안 되는 시간도 막대가 보이게 올림).
  const minutes = weeks.map((w) => Math.ceil(w.seconds / 60))
  const average = weeks.reduce((sum, w) => sum + w.seconds, 0) / Math.max(1, weeks.length)

  return (
    <section aria-labelledby="cardio-title" className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="cardio-title" className="font-bold text-ink">
          유산소
        </h2>
        <p className="text-xs text-muted">최근 {WEEKS}주</p>
      </div>

      <div className="mt-3">
        <ChartReadout
          value={formatCardioTime(weeks[selected].seconds)}
          label={weekName(weeks, selected)}
          aside={
            <>
              {WEEKS}주 평균
              <br />
              <span className="font-semibold text-ink">{formatCardioTime(Math.round(average / 60) * 60)}</span>
            </>
          }
        />
      </div>

      <div className="mt-2">
        {minutes.every((v) => v === 0) ? (
          <p className="flex h-40 items-center justify-center text-sm text-muted">
            최근 {WEEKS}주에는 유산소 기록이 없습니다.
          </p>
        ) : (
          <ColumnChart
            values={minutes}
            labels={weeks.map((w) => shortDate(w.start))}
            strongLabel={last}
            selected={selected}
            onSelect={(i) => setPicked(weeks[i].start)}
            name="주별 유산소 시간 그래프"
            valueText={(i) => `${weekName(weeks, i)}, ${formatCardioTime(weeks[i].seconds)}`}
            unit="분"
            integer
          />
        )}
      </div>
      <p className="mt-1 text-xs text-muted">유산소 종목의 완료한 세트 시간을 주마다 더한 값입니다(웜업 제외).</p>
      <ChartTable
        caption={`최근 ${WEEKS}주 주별 유산소 시간`}
        headers={['주', '유산소 시간']}
        rows={weeks.map((w) => [formatWeekRange(w.start), formatCardioTime(w.seconds)])}
      />
    </section>
  )
}

function BodyPartCard({ data, now }: { data: StatsData; now: number }) {
  const range = lastDays(BODY_PART_DAYS, now)
  const rows = bodyPartSets(data.sessions, data.exercises, range)
  const total = rows.reduce((n, r) => n + r.sets, 0)

  return (
    <section aria-labelledby="bodypart-title" className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="bodypart-title" className="font-bold text-ink">
          부위별 세트
        </h2>
        <p className="text-xs text-muted">최근 4주 · {formatMonthDay(range.from, now)}부터</p>
      </div>
      {total === 0 ? (
        <p className="mt-3 text-sm text-muted">최근 4주에는 끝낸 운동이 없습니다.</p>
      ) : (
        <>
          <div className="mt-3">
            <RankedBars
              name="최근 4주 부위별 세트 수"
              unit="세트"
              rows={rows.map((r) => ({ key: r.bodyPart, label: r.label, value: r.sets }))}
            />
          </div>
          <p className="mt-2 text-xs text-muted">웜업을 뺀 완료 세트 수입니다. 모두 {total}세트.</p>
        </>
      )}
    </section>
  )
}

function CalendarCard({ data, now }: { data: StatsData; now: number }) {
  const navigate = useNavigate()
  const current = monthOf(now)
  const first = monthOf(data.workouts[0].startedAt)
  const [shown, setShown] = useState<YearMonth>(current)
  const [picking, setPicking] = useState<{ day: number; ids: string[] } | null>(null)
  const days = workoutDaysInMonth(data.workouts, shown)
  const before = (a: YearMonth, b: YearMonth) => a.year < b.year || (a.year === b.year && a.month < b.month)

  const workoutById = new Map(data.workouts.map((w) => [w.id, w]))
  const namesOf = (workoutId: string): string => {
    const names = data.sessions
      .filter((s) => s.workout.id === workoutId)
      .sort((a, b) => a.we.order - b.we.order)
      .map((s) => data.exercises.get(s.we.exerciseId)?.name ?? '지워진 종목')
    return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} 외 ${names.length - 2}개`
  }

  return (
    <section aria-labelledby="calendar-title" className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <h2 id="calendar-title" className="font-bold text-ink">
        운동 달력
      </h2>
      <div className="mt-1">
        <MonthCalendar
          month={shown}
          days={days}
          today={now}
          canPrev={before(first, shown)}
          canNext={before(shown, current)}
          onPrev={() => setShown(addMonths(shown, -1))}
          onNext={() => setShown(addMonths(shown, 1))}
          onPick={(day, ids) => {
            if (ids.length === 1) navigate(`/history/${ids[0]}`)
            else setPicking({ day, ids })
          }}
        />
      </div>
      {!sameMonth(shown, current) && (
        <button
          type="button"
          onClick={() => setShown(current)}
          className="mx-auto mt-1 block px-4 py-2 text-sm font-medium text-accent"
        >
          이번 달로
        </button>
      )}

      <Dialog
        open={picking !== null}
        title={picking ? `${shown.month + 1}월 ${picking.day}일 운동` : ''}
        onClose={() => setPicking(null)}
        actions={[{ label: '닫기', onClick: () => setPicking(null) }]}
      >
        <p>이날 운동을 {picking?.ids.length}번 했습니다. 볼 기록을 골라 주세요.</p>
        <div className="mt-3 grid gap-2">
          {picking?.ids.map((id) => {
            const w = workoutById.get(id)
            return (
              <button
                key={id}
                type="button"
                onClick={() => navigate(`/history/${id}`)}
                className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-line bg-bg px-4 py-2 text-left active:bg-surface-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{w ? `${formatTime(w.startedAt)} 시작` : '운동'}</span>
                  <span className="block truncate text-sm text-muted">{namesOf(id)}</span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-muted" />
              </button>
            )
          })}
        </div>
      </Dialog>
    </section>
  )
}

function ExerciseList({ data }: { data: StatsData }) {
  const list = exerciseOverviews(data.sessionsByExercise, data.exercises)
  if (list.length === 0) return null

  return (
    <section aria-labelledby="exercises-title" className="mt-6">
      <h2 id="exercises-title" className="font-bold text-ink">
        종목별 기록
      </h2>
      <p className="text-xs text-muted">최근에 한 종목부터. 누르면 성장 그래프와 개인 기록을 볼 수 있습니다.</p>
      <ul className="mt-3 grid gap-2">
        {list.map((o) => {
          const ex = data.exercises.get(o.exerciseId)
          const best =
            o.bestE1rm !== null
              ? { label: '추정 1RM', value: formatMetric('bestE1rm', o.bestE1rm) }
              : o.maxWeight !== null
                ? { label: recordLabel('maxWeight', ex), value: formatMetric('topWeight', o.maxWeight, ex) }
                : o.maxReps !== null
                  ? { label: '최다 횟수', value: formatMetric('maxReps', o.maxReps) }
                  : o.maxDuration !== null
                    ? { label: '최장 시간', value: formatMetric('maxDuration', o.maxDuration, ex) }
                    : null
          return (
            <li key={o.exerciseId} className="min-w-0">
              <Link
                to={`/exercises/${o.exerciseId}`}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 active:bg-surface-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink">{ex?.name ?? '지워진 종목'}</p>
                  <p className="mt-0.5 truncate text-sm text-muted">
                    {ex ? `${bodyPartLabel(ex.bodyPart)} · ` : ''}
                    {formatMonthDay(o.lastAt)} · {o.sessionCount}회 기록
                  </p>
                </div>
                {best && (
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted">{best.label}</p>
                    <p className="font-semibold tabular-nums text-ink">{best.value}</p>
                  </div>
                )}
                <ChevronRightIcon className="size-5 shrink-0 text-muted" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
