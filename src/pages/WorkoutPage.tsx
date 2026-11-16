import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AiWorkoutPanel } from '../components/AiWorkoutPanel'
import { Dialog } from '../components/Dialog'
import { ExerciseCard } from '../components/ExerciseCard'
import { PlusIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { getWorkoutAdvice } from '../lib/ai/advice'
import { getAiModel } from '../lib/ai/models'
import { formatClock } from '../lib/format'
import { findNewRecords } from '../lib/history'
import { getWorkoutRecommendations } from '../lib/recommend'
import { getAiApiKey, getAiEnabled, getRecommendEnabled } from '../lib/settings'
import { useGoBack } from '../lib/useGoBack'
import { useNow } from '../lib/useNow'
import { deleteWorkout, loadWorkoutDetail } from '../lib/workouts'
import { useRestTimer } from '../rest/context'
import { RestTimerBar } from '../rest/RestTimerBar'

/** 추천이나 기록 계산이 실패해도 운동 기록은 계속할 수 있게 빈 값으로 바꾼다. */
function orEmpty<T>(promise: Promise<T>, empty: T): Promise<T> {
  return promise.catch(() => empty)
}

/** 운동 진행 화면. 종목별로 세트를 입력하고 완료를 체크한다. */
export default function WorkoutPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack('/')
  const rest = useRestTimer()
  const now = useNow(1000)
  const [askCancel, setAskCancel] = useState(false)
  const detail = useLiveQuery(() => loadWorkoutDetail(id, { withLastSets: true }), [id])
  // 추천과 새 기록은 따로 구독한다. 한 쿼리 안에서 여러 겹의 async 함수를 이어 부르면
  // Dexie가 뒤쪽 읽기를 추적하지 못해 세트를 바꿔도 다시 계산되지 않는 일이 있다.
  const recommendOn = useLiveQuery(getRecommendEnabled, [])
  // 추천은 지난 기록만 보므로 세트를 입력하는 동안에는 바뀌지 않는다.
  const recommendations = useLiveQuery(() => orEmpty(getWorkoutRecommendations(id), new Map()), [id])
  const records = useLiveQuery(() => orEmpty(findNewRecords(id), []), [id])
  // AI 추천(3단계). 설정에서 켰을 때만 보인다. 키 자체는 화면에 넘기지 않고 있는지만 본다.
  const ai = useLiveQuery(async () => {
    const [enabled, key, model] = await Promise.all([getAiEnabled(), getAiApiKey(), getAiModel()])
    return { enabled, hasKey: key !== null, model }
  }, [])
  const advice = useLiveQuery(() => orEmpty(getWorkoutAdvice(id), null), [id])

  // 추천이 나중에 끼어들어 세트 줄이 밀리지 않도록, 추천까지 준비된 뒤에 그린다.
  // (PR 표시는 자리를 차지하지 않으니 기다리지 않는다.)
  if (
    detail === undefined ||
    recommendOn === undefined ||
    recommendations === undefined ||
    ai === undefined ||
    advice === undefined
  ) {
    return null
  }
  if (detail === null) return <Navigate to="/" replace />
  if (detail.workout.endedAt !== null) return <Navigate to={`/history/${id}`} replace />

  const { workout, items } = detail

  const cancel = async () => {
    rest.stop()
    await deleteWorkout(id)
    navigate('/', { replace: true })
  }

  return (
    <>
      <PageHeader
        title="운동 중"
        subtitle={formatClock(now - workout.startedAt)}
        onBack={goBack}
        right={
          <button
            type="button"
            onClick={() => navigate(`/workout/${id}/done`, { replace: true })}
            className="mr-1 h-10 shrink-0 rounded-xl bg-accent px-4 text-[15px] font-bold text-on-accent active:opacity-80"
          >
            마치기
          </button>
        }
      />

      <main className={`flex-1 px-3 pt-3 ${rest.active ? 'pb-56' : 'pb-10'}`}>
        {ai.enabled && (
          <AiWorkoutPanel
            workoutId={id}
            model={ai.model}
            hasKey={ai.hasKey}
            hasItems={items.length > 0}
            advice={advice}
          />
        )}

        {items.length === 0 && (
          <p className="px-2 py-8 text-center leading-relaxed text-muted">
            오늘 할 종목을 추가해 주세요.
            <br />
            지난번에 한 무게와 횟수가 미리 채워집니다.
          </p>
        )}

        <div className="grid gap-3">
          {items.map((item, index) => (
            <ExerciseCard
              key={item.we.id}
              item={item}
              mode="active"
              index={index}
              count={items.length}
              onSetDone={() => rest.start(item.exercise?.restSeconds)}
              recommendation={recommendOn ? (recommendations.get(item.we.id) ?? null) : null}
              records={records}
              aiSuggestion={
                ai.enabled ? advice?.exercises.find((e) => e.workoutExerciseId === item.we.id) ?? null : null
              }
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => navigate(`/workout/${id}/pick`)}
          className="mt-3 flex h-14 w-full items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-base font-bold text-accent active:bg-surface-2"
        >
          <PlusIcon className="size-5" />
          종목 추가
        </button>

        <button
          type="button"
          onClick={() => setAskCancel(true)}
          className="mx-auto mt-8 block px-4 py-3 text-sm text-muted underline underline-offset-4"
        >
          운동 취소
        </button>
      </main>

      <RestTimerBar />

      <Dialog
        open={askCancel}
        title="운동을 취소할까요?"
        onClose={() => setAskCancel(false)}
        actions={[
          { label: '취소하고 지우기', tone: 'danger', onClick: () => void cancel() },
          { label: '계속 운동하기', onClick: () => setAskCancel(false) },
        ]}
      >
        지금까지 입력한 세트가 모두 지워지고 기록에 남지 않습니다.
      </Dialog>
    </>
  )
}
