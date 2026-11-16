import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { PageHeader } from '../components/PageHeader'
import { formatDuration, formatVolume } from '../lib/format'
import { deleteWorkout, finishWorkout, loadWorkoutDetail, markEnteredSetsDone, totalVolume } from '../lib/workouts'
import { useRestTimer } from '../rest/context'

/** 운동 완료 화면. 요약을 보고 메모를 남긴 뒤 저장한다. */
export default function WorkoutDone() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const rest = useRestTimer()
  // 이 화면을 연 시각을 운동이 끝난 시각으로 쓴다.
  const [openedAt] = useState(() => Date.now())
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [askDiscard, setAskDiscard] = useState(false)
  const detail = useLiveQuery(() => loadWorkoutDetail(id), [id])

  if (detail === undefined) return null
  if (detail === null) return <Navigate to="/" replace />
  if (detail.workout.endedAt !== null) return <Navigate to={`/history/${id}`} replace />

  const backToWorkout = () => navigate(`/workout/${id}`, { replace: true })

  const allSets = detail.items.flatMap((item) => item.sets)
  const doneSets = allSets.filter((s) => s.isDone)
  // 횟수는 적었는데 완료 체크를 하지 않은 세트
  const pending = allSets.filter((s) => !s.isDone && (s.reps ?? 0) > 0)
  const doneExercises = detail.items.filter((item) => item.sets.some((s) => s.isDone)).length

  const save = async () => {
    if (saving) return
    setSaving(true)
    const ok = await finishWorkout(id, { memo, endedAt: openedAt })
    if (!ok) {
      setSaving(false)
      return
    }
    rest.stop()
    navigate(`/history/${id}`, { replace: true })
  }

  const discard = async () => {
    rest.stop()
    await deleteWorkout(id)
    navigate('/', { replace: true })
  }

  return (
    <>
      <PageHeader title="운동 완료" onBack={backToWorkout} backLabel="운동으로 돌아가기" />

      <main className="flex-1 px-4 pb-10 pt-4">
        <dl className="grid grid-cols-2 gap-2">
          <Stat label="운동 시간" value={formatDuration(openedAt - detail.workout.startedAt)} />
          <Stat label="총 볼륨" value={`${formatVolume(totalVolume(allSets))}kg`} />
          <Stat label="종목" value={`${doneExercises}개`} />
          <Stat label="완료한 세트" value={`${doneSets.length}개`} />
        </dl>

        {pending.length > 0 && (
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <p className="leading-relaxed text-ink">
              완료 체크를 하지 않은 세트가 {pending.length}개 있습니다. 그대로 저장하면 이 세트는 기록에서 빠집니다.
            </p>
            <button
              type="button"
              onClick={() => void markEnteredSetsDone(id)}
              className="mt-3 h-12 w-full rounded-xl bg-surface-2 font-semibold text-ink active:opacity-70"
            >
              모두 완료로 표시
            </button>
          </section>
        )}

        {doneSets.length === 0 ? (
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <p className="leading-relaxed text-ink">완료한 세트가 없어서 저장할 기록이 없습니다.</p>
            <button
              type="button"
              onClick={backToWorkout}
              className="mt-3 h-12 w-full rounded-xl bg-accent font-bold text-on-accent active:opacity-80"
            >
              운동으로 돌아가기
            </button>
            <button
              type="button"
              onClick={() => setAskDiscard(true)}
              className="mt-2 h-12 w-full rounded-xl bg-surface-2 font-semibold text-danger active:opacity-70"
            >
              기록하지 않고 끝내기
            </button>
          </section>
        ) : (
          <>
            <label className="mt-5 grid gap-2 font-bold text-ink">
              메모
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.currentTarget.value)}
                rows={3}
                maxLength={500}
                placeholder="오늘 컨디션이나 다음에 기억할 점 (선택)"
                className="resize-none rounded-xl border border-line bg-surface p-3 font-normal text-ink outline-none placeholder:text-muted focus:border-accent"
              />
            </label>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="mt-5 h-14 w-full rounded-2xl bg-accent text-lg font-bold text-on-accent active:opacity-80 disabled:opacity-50"
            >
              저장
            </button>
            <button
              type="button"
              onClick={backToWorkout}
              className="mt-2 h-12 w-full rounded-xl font-semibold text-muted active:bg-surface-2"
            >
              운동으로 돌아가기
            </button>
          </>
        )}
      </main>

      <Dialog
        open={askDiscard}
        title="기록하지 않고 끝낼까요?"
        onClose={() => setAskDiscard(false)}
        actions={[
          { label: '끝내고 지우기', tone: 'danger', onClick: () => void discard() },
          { label: '취소', onClick: () => setAskDiscard(false) },
        ]}
      >
        이 운동에 입력한 내용이 모두 지워집니다.
      </Dialog>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-bold tabular-nums text-ink">{value}</dd>
    </div>
  )
}
