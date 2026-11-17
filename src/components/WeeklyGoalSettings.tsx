import { useLiveQuery } from 'dexie-react-hooks'
import { getWeeklyGoal } from '../lib/settings'
import { saveWeeklyGoal } from '../lib/weeklyGoal'
import { WeeklyGoalPicker } from './WeeklyGoalPicker'

/**
 * 설정 화면의 주간 목표(주에 몇 번 운동할지) 칸. 고르면 바로 저장한다.
 */
export function WeeklyGoalSettings() {
  const goal = useLiveQuery(getWeeklyGoal, [])

  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4" aria-label="주간 목표">
      <h2 className="font-bold text-ink">주간 목표</h2>
      <p className="mt-1 break-keep text-sm leading-relaxed text-muted">
        한 주(월~일)에 운동할 횟수를 정하면 홈에서 이번 주 진행과 목표를 연속으로 채운 주를 보여 줍니다. 목표를 바꾸면
        지난 주들도 새 목표로 다시 셉니다.
      </p>
      <div className="mt-3">
        <WeeklyGoalPicker value={goal} onChange={(next) => void saveWeeklyGoal(next)} />
      </div>
    </section>
  )
}
