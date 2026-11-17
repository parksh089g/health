import type { SetEntry } from '../db'
import { applyRecommendation, formatRecommendation, isRecommendationApplied, type Recommendation } from '../lib/recommend'
import { CheckIcon, SparkleIcon } from './icons'

interface RecommendationBarProps {
  workoutExerciseId: string
  sets: SetEntry[]
  recommendation: Pick<Recommendation, 'weightKg' | 'reps' | 'reason' | 'fromWeightKg' | 'durationSec'>
  /** 맨몸 종목인지. 무게를 "+10kg"처럼 추가 무게로 보여 주고, 맨몸 세트와 추가 무게 세트를 나눠 채운다. */
  addedWeight: boolean
  /** rule: 앱의 규칙 추천, ai: Claude의 추천 */
  variant?: 'rule' | 'ai'
}

/**
 * 다음 무게 추천 한 줄. "적용"을 누르면 아직 완료하지 않은 본 세트에 추천 값을 채운다(자동으로 바꾸지 않는다).
 * 버튼 폭을 고정해서 "적용"과 "적용됨"이 바뀌어도 아래 세트 줄이 움직이지 않게 한다.
 */
export function RecommendationBar({
  workoutExerciseId,
  sets,
  recommendation: rec,
  addedWeight,
  variant = 'rule',
}: RecommendationBarProps) {
  const applied = isRecommendationApplied(sets, rec, { addedWeight })
  const hasPending = sets.some((s) => !s.isDone && !s.isWarmup)
  const value = formatRecommendation(rec, { addedWeight })
  const ai = variant === 'ai'

  return (
    <div
      role="group"
      aria-label={ai ? 'AI 추천' : '다음 무게 추천'}
      className="mt-2 flex items-center gap-2 rounded-xl bg-accent-soft py-2 pl-3 pr-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug text-ink">
          {ai ? (
            <span className="mr-0.5 inline-flex items-center gap-0.5 font-semibold text-accent">
              <SparkleIcon className="size-4" />
              AI
            </span>
          ) : (
            <span className="font-semibold text-accent">추천</span>
          )}{' '}
          <strong className="font-bold tabular-nums">{value}</strong>
        </p>
        <p className="mt-0.5 break-keep text-sm leading-snug text-muted">{rec.reason}</p>
      </div>
      <button
        type="button"
        disabled={applied || !hasPending}
        onClick={() => void applyRecommendation(workoutExerciseId, rec, { addedWeight })}
        aria-label={applied ? '추천 적용됨' : `추천 ${value} 적용`}
        className={`flex h-11 w-[4.75rem] shrink-0 items-center justify-center gap-0.5 rounded-lg text-[15px] font-bold ${
          applied ? 'text-accent' : 'bg-accent text-on-accent active:opacity-80 disabled:opacity-40'
        }`}
      >
        {applied && <CheckIcon className="size-4" />}
        {applied ? '적용됨' : '적용'}
      </button>
    </div>
  )
}
