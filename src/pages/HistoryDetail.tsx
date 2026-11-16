import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AiFeedbackCard } from '../components/AiFeedbackCard'
import { Dialog } from '../components/Dialog'
import { ExerciseCard } from '../components/ExerciseCard'
import { PageHeader } from '../components/PageHeader'
import { SaveAsRoutine } from '../components/SaveAsRoutine'
import { formatDay, formatDuration, formatTime, formatVolume } from '../lib/format'
import { findNewRecords } from '../lib/history'
import { useGoBack } from '../lib/useGoBack'
import { deleteWorkout, loadWorkoutDetail, repeatWorkout, totalVolume, updateWorkoutMemo } from '../lib/workouts'

/** 기록 상세. 지난 운동의 세트를 고치거나 지우고, 같은 종목으로 다시 시작할 수 있다. */
export default function HistoryDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/history')
  const [askDelete, setAskDelete] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const detail = useLiveQuery(() => loadWorkoutDetail(id), [id])
  const records = useLiveQuery(() => findNewRecords(id), [id])

  if (detail === undefined) return null
  if (detail === null) return <Navigate to="/history" replace />
  if (detail.workout.endedAt === null) return <Navigate to={`/workout/${id}`} replace />

  const { workout, items } = detail
  const endedAt = workout.endedAt ?? workout.startedAt
  const allSets = items.flatMap((item) => item.sets)

  const repeat = async () => {
    const result = await repeatWorkout(id)
    if (result.created) navigate(`/workout/${result.id}`)
    else setActiveId(result.id)
  }

  const remove = async () => {
    await deleteWorkout(id)
    navigate('/history', { replace: true })
  }

  return (
    <>
      <PageHeader
        title={formatDay(workout.startedAt)}
        subtitle={`${formatTime(workout.startedAt)} 시작 · ${formatDuration(endedAt - workout.startedAt)}`}
        onBack={goBack}
      />

      <main className="flex-1 px-3 pb-10 pt-3">
        <p className="px-1 text-sm tabular-nums text-muted">
          종목 {items.length}개 · {allSets.filter((s) => s.isDone).length}세트 · 볼륨 {formatVolume(totalVolume(allSets))}kg
          {records && records.length > 0 && (
            <span className="font-semibold text-accent"> · 새 기록 {records.length}개</span>
          )}
        </p>

        <MemoField key={workout.id} workoutId={workout.id} initial={workout.memo} />
        <AiFeedbackCard key={`ai-${workout.id}`} workoutId={workout.id} />

        <div className="mt-3 grid gap-3">
          {items.map((item) => (
            <ExerciseCard key={item.we.id} item={item} mode="history" records={records} />
          ))}
        </div>

        <button
          type="button"
          onClick={() => void repeat()}
          disabled={items.length === 0}
          className="mt-4 h-14 w-full rounded-2xl bg-accent text-base font-bold text-on-accent active:opacity-80 disabled:opacity-40"
        >
          같은 운동 다시 하기
        </button>
        <SaveAsRoutine workout={workout} items={items} />
        <button
          type="button"
          onClick={() => setAskDelete(true)}
          className="mx-auto mt-6 block px-4 py-3 text-sm text-danger underline underline-offset-4"
        >
          이 기록 삭제
        </button>
      </main>

      <Dialog
        open={askDelete}
        title="이 기록을 삭제할까요?"
        onClose={() => setAskDelete(false)}
        actions={[
          { label: '삭제', tone: 'danger', onClick: () => void remove() },
          { label: '취소', onClick: () => setAskDelete(false) },
        ]}
      >
        삭제한 기록은 되돌릴 수 없습니다.
      </Dialog>

      <Dialog
        open={activeId !== null}
        title="진행 중인 운동이 있습니다"
        onClose={() => setActiveId(null)}
        actions={[
          { label: '진행 중인 운동 열기', tone: 'primary', onClick: () => navigate(`/workout/${activeId}`) },
          { label: '닫기', onClick: () => setActiveId(null) },
        ]}
      >
        그 운동을 마치거나 취소한 뒤에 새 운동을 시작할 수 있습니다.
      </Dialog>
    </>
  )
}

function MemoField({ workoutId, initial }: { workoutId: string; initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={() => {
        if (text.trim() !== initial) void updateWorkoutMemo(workoutId, text.trim())
      }}
      rows={2}
      maxLength={500}
      aria-label="메모"
      placeholder="메모"
      className="mt-3 w-full resize-none rounded-xl border border-line bg-surface p-3 text-ink outline-none placeholder:text-muted focus:border-accent"
    />
  )
}
