import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { Workout } from '../db'
import { getWeeklyGoal } from '../lib/settings'
import { saveWeeklyGoal, weeklyGoalStatus } from '../lib/weeklyGoal'
import { countThisWeek, daysWorkedThisWeek } from '../lib/workouts'
import { Dialog } from './Dialog'
import { CheckIcon } from './icons'
import { WeeklyGoalPicker } from './WeeklyGoalPicker'

const WEEK_LABELS = ['월', '화', '수', '목', '금', '토', '일']

interface WeekCardProps {
  /** 운동 목록. 끝난 것만 센다. */
  workouts: Pick<Workout, 'startedAt' | 'endedAt'>[]
  now: number
}

/**
 * 홈의 "이번 주 운동" 카드. 이번 주에 운동한 횟수와 요일을 보여 준다.
 * 주간 목표를 정했으면 목표까지의 진행, 남은 횟수, 연속으로 채운 주도 보여 주고, 여기서 바로 목표를 정하거나 바꾼다.
 * 세는 방법은 lib/weeklyGoal.ts에 적어 두었다.
 */
export function WeekCard({ workouts, now }: WeekCardProps) {
  // 읽는 중이면 undefined, 목표가 없으면 null
  const goal = useLiveQuery(getWeeklyGoal, [])
  const [editing, setEditing] = useState(false)

  const count = countThisWeek(workouts, now)
  const weekDays = daysWorkedThisWeek(workouts, now)
  const todayIndex = (new Date(now).getDay() + 6) % 7
  const status = weeklyGoalStatus(workouts, goal, now)

  const pick = (next: number | null) => {
    void saveWeeklyGoal(next)
    setEditing(false)
  }

  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4" aria-label="이번 주 운동">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-ink">이번 주 운동</h2>
        <p className="text-ink">
          <span className={`text-2xl font-bold tabular-nums ${status?.met ? 'text-good' : ''}`}>{count}</span>
          {status && <span className="text-base font-semibold tabular-nums text-muted"> / {status.goal}</span>}
          <span className="ml-0.5 text-sm text-muted">회</span>
        </p>
      </div>

      {status && (
        <div
          role="progressbar"
          aria-label="주간 목표 진행"
          aria-valuemin={0}
          aria-valuemax={status.goal}
          aria-valuenow={Math.min(status.count, status.goal)}
          aria-valuetext={`${status.goal}회 중 ${status.count}회`}
          className="mt-2 flex gap-1"
        >
          {/* 목표 횟수만큼 칸을 나눠서 몇 번 했고 몇 번 남았는지 한눈에 보이게 한다. */}
          {Array.from({ length: status.goal }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < status.count ? (status.met ? 'bg-good' : 'bg-accent') : 'bg-surface-2'
              }`}
            />
          ))}
        </div>
      )}

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

      {/* 버튼은 44px 높이로 누르되, 카드 아래 여백과 겹쳐서 카드가 글 한 줄만큼만 길어지게 한다. */}
      <div className="-mb-3 flex min-h-11 items-center gap-2">
        {/* 좁은 화면에서는 남은 횟수와 연속 달성 사이에서만 줄이 바뀐다(가운뎃점은 앞줄 끝에 남는다). */}
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 text-sm">
          {status && (
            <span className="whitespace-nowrap">
              {status.met ? (
                <span className="font-semibold text-good">
                  <CheckIcon className="mr-1 inline size-4 align-[-3px]" />
                  목표 달성
                </span>
              ) : (
                <span className="font-semibold text-ink">{status.remaining}번 더</span>
              )}
              {status.streak >= 1 && <span className="text-muted"> ·</span>}
            </span>
          )}{' '}
          {status && status.streak >= 1 && (
            <span className="whitespace-nowrap text-muted">{status.streak}주 연속 달성</span>
          )}
        </p>
        {goal !== undefined && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="-mr-2 h-11 shrink-0 rounded-xl px-2 text-sm font-medium text-accent active:bg-surface-2"
          >
            {goal === null ? '주간 목표 정하기' : '목표 바꾸기'}
          </button>
        )}
      </div>

      <Dialog
        open={editing}
        title="주간 목표"
        onClose={() => setEditing(false)}
        actions={[{ label: '닫기', onClick: () => setEditing(false) }]}
      >
        한 주(월~일)에 운동할 횟수를 고릅니다.
        <div className="mt-3">
          <WeeklyGoalPicker value={goal} onChange={pick} />
        </div>
      </Dialog>
    </section>
  )
}
