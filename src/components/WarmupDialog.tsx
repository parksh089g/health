import { formatKg } from '../lib/format'
import { describePlateLoad, platesFor, type PlateSetup } from '../lib/plates'
import { usePlateSetup } from '../lib/usePlateSetup'
import { applyWarmup, buildWarmupPlan } from '../lib/warmup'
import type { WorkoutItem } from '../lib/workouts'
import { Dialog } from './Dialog'

interface WarmupDialogProps {
  item: WorkoutItem
  onClose: () => void
}

/**
 * 웜업 세트 만들기 창. 본 세트 무게로 만든 웜업 세트를 먼저 보여 주고, "넣기"를 눌러야 세트에 들어간다.
 * 본 세트에 무게가 없거나 넣을 세트가 없으면 까닭만 알려 준다.
 */
export function WarmupDialog({ item, onClose }: WarmupDialogProps) {
  const setup = usePlateSetup()
  // 설정을 읽어 오는 동안(아주 잠깐)은 그리지 않는다.
  if (!setup) return null

  const bar: PlateSetup | null = item.exercise?.equipment === 'barbell' ? setup : null
  const plan = buildWarmupPlan(item.sets, bar)
  const close = { label: '확인', onClick: onClose }

  if (plan.workingKg === null) {
    return (
      <Dialog open title="웜업 세트 만들기" onClose={onClose} actions={[close]}>
        <p className="break-keep">본 세트에 무게를 먼저 적어 주세요. 그 무게에 맞춰 웜업 세트를 만듭니다.</p>
      </Dialog>
    )
  }

  const working = `${formatKg(plan.workingKg)}kg`
  if (plan.steps.length === 0) {
    return (
      <Dialog open title="웜업 세트 만들기" onClose={onClose} actions={[close]}>
        <p className="break-keep">
          {item.sets.some((s) => s.isWarmup && s.isDone)
            ? `본 세트 ${working}에 맞는 웜업 세트는 이미 다 했습니다.`
            : `본 세트가 ${working}이라 따로 넣을 웜업 세트가 없습니다.`}
        </p>
      </Dialog>
    )
  }

  const apply = () => {
    void applyWarmup(item.we.id, plan.steps)
    onClose()
  }

  return (
    <Dialog
      open
      title="웜업 세트 만들기"
      onClose={onClose}
      actions={[
        { label: plan.replaces > 0 ? '바꿔 넣기' : '넣기', tone: 'primary', onClick: apply },
        { label: '취소', onClick: onClose },
      ]}
    >
      <p className="break-keep">본 세트 {working}에 맞춰 첫 본 세트 앞에 넣습니다.</p>
      <ul className="mt-2 divide-y divide-line border-y border-line" aria-label="넣을 웜업 세트">
        {plan.steps.map((step) => (
          <li key={step.weightKg} className="flex min-h-11 items-baseline gap-3 py-2">
            <span className="shrink-0 text-base font-bold tabular-nums text-ink">
              {formatKg(step.weightKg)}kg × {step.reps}회
            </span>
            {bar && (
              <span className="min-w-0 flex-1 text-right text-sm tabular-nums">
                {describePlateLoad(platesFor(step.weightKg, bar), bar.barKg).main}
              </span>
            )}
          </li>
        ))}
      </ul>
      {plan.replaces > 0 && (
        <p className="mt-2 break-keep">아직 하지 않은 웜업 세트 {plan.replaces}개는 지우고 새로 넣습니다.</p>
      )}
    </Dialog>
  )
}
