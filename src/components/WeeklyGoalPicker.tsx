import { WEEKLY_GOAL_OPTIONS } from '../lib/weeklyGoal'

interface WeeklyGoalPickerProps {
  /** 지금 목표. 없으면 null, 아직 읽는 중이면 undefined(아무것도 고르지 않은 것으로 보인다) */
  value: number | null | undefined
  onChange: (goal: number | null) => void
}

/** 주간 목표를 없음과 1~7회 중에서 고르는 버튼 묶음. 설정 화면과 홈의 목표 창이 같이 쓴다. */
export function WeeklyGoalPicker({ value, onChange }: WeeklyGoalPickerProps) {
  return (
    <div role="group" aria-label="주간 목표 횟수" className="grid grid-cols-4 gap-2">
      {[null, ...WEEKLY_GOAL_OPTIONS].map((option) => (
        <button
          key={option ?? 'none'}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`h-12 rounded-xl text-base font-semibold active:opacity-70 ${
            value === option ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
          }`}
        >
          {option === null ? '없음' : `${option}회`}
        </button>
      ))}
    </div>
  )
}
