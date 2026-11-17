import { useLiveQuery } from 'dexie-react-hooks'
import type { SetEntry } from '../db'
import { useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { AiWorkoutPanel } from '../components/AiWorkoutPanel'
import { Dialog } from '../components/Dialog'
import { ExerciseCard } from '../components/ExerciseCard'
import { PlusIcon } from '../components/icons'
import { PageHeader } from '../components/PageHeader'
import { SupersetFrame } from '../components/SupersetFrame'
import { getWorkoutAdvice } from '../lib/ai/advice'
import { getAiModel } from '../lib/ai/models'
import { formatClock, formatDay, formatTime } from '../lib/format'
import { findNewRecords } from '../lib/history'
import { isCardio, isTimed } from '../lib/measure'
import { getWorkoutRecommendations } from '../lib/recommend'
import { MISSING_EXERCISE_NAME } from '../lib/routines'
import { getAiApiKey, getAiEnabled, getRecommendEnabled } from '../lib/settings'
import { afterSetDone, linkWithNextExercise, supersetPositions, unlinkFromNextExercise } from '../lib/supersets'
import { useGoBack } from '../lib/useGoBack'
import { useNow } from '../lib/useNow'
import { deleteWorkout, isPastWorkout, loadWorkoutDetail, type WorkoutItem } from '../lib/workouts'
import { useRestTimer } from '../rest/context'
import { RestTimerBar } from '../rest/RestTimerBar'

/** 추천이나 기록 계산이 실패해도 운동 기록은 계속할 수 있게 빈 값으로 바꾼다. */
function orEmpty<T>(promise: Promise<T>, empty: T): Promise<T> {
  return promise.catch(() => empty)
}

/** 종목 카드를 감싼 요소의 id. 슈퍼세트에서 다음 종목의 카드로 화면을 옮길 때 찾는다. */
const cardId = (workoutExerciseId: string) => `workout-exercise-${workoutExerciseId}`

const nameOf = (item: WorkoutItem) => item.exercise?.name ?? MISSING_EXERCISE_NAME

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
  // 지난 운동을 나중에 적는 중이면 휴식 타이머, 스톱워치, 추천, AI 추천을 쓰지 않는다(그날 이미 한 운동이라).
  const past = isPastWorkout(workout)
  const positions = supersetPositions(items.map((item) => item.we))

  /**
   * 세트를 완료하면 휴식 타이머를 시작한다. 슈퍼세트에서는 한 바퀴를 마쳤을 때만 쉬고,
   * 그 전에는 쉬지 않고 다음 종목의 카드를 화면에 보여 준다. 유산소는 타이머를 시작하지 않는다.
   * 웜업 세트는 바퀴에 들지 않으니, 묶음 안에서도 다음 종목으로 넘어가지 않고 그 종목의 휴식만큼 쉰다.
   */
  const onSetDone = (item: WorkoutItem, set: SetEntry) => {
    if (past) return
    if (set.isWarmup) {
      if (!isCardio(item.exercise)) rest.start(item.exercise?.restSeconds)
      return
    }
    const next = afterSetDone(items, item.we.id)
    if (next.kind === 'rest') rest.start(next.restSeconds)
    if (next.kind !== 'next') return
    // 다음 종목으로 바로 넘어가니, 앞에서 돌던 휴식은 끝낸다(다음 종목을 하는 중에 알림이 울리지 않게).
    rest.stop()
    document.getElementById(cardId(next.workoutExerciseId))?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const cancel = async () => {
    rest.stop()
    await deleteWorkout(id)
    navigate('/', { replace: true })
  }

  return (
    <>
      <PageHeader
        title={past ? '지난 운동 적기' : '운동 중'}
        subtitle={
          past ? `${formatDay(workout.startedAt)} ${formatTime(workout.startedAt)}` : formatClock(now - workout.startedAt)
        }
        onBack={goBack}
        right={
          <button
            type="button"
            onClick={() => navigate(`/workout/${id}/done`, { replace: true })}
            className="mr-1 h-11 shrink-0 rounded-xl bg-accent px-4 text-[15px] font-bold text-on-accent active:opacity-80"
          >
            마치기
          </button>
        }
      />

      <main className={`flex-1 px-3 pt-3 ${rest.active ? 'pb-64' : 'pb-10'}`}>
        {ai.enabled && !past && (
          <AiWorkoutPanel
            workoutId={id}
            model={ai.model}
            hasKey={ai.hasKey}
            hasItems={items.some((item) => item.exercise !== undefined && !isTimed(item.exercise))}
            advice={advice}
          />
        )}

        {items.length === 0 && (
          <p className="px-2 py-8 text-center leading-relaxed text-muted">
            {past ? '그날 한 종목을 추가해 주세요.' : '오늘 할 종목을 추가해 주세요.'}
            <br />
            {past ? '그날 전에 한 무게와 횟수가 미리 채워집니다.' : '지난번에 한 무게와 횟수가 미리 채워집니다.'}
          </p>
        )}

        {/* 카드 사이의 틈에 슈퍼세트로 묶고 푸는 버튼이 있다. 묶인 카드는 한 바탕에 이어 담긴다. */}
        <div>
          {items.map((item, index) => {
            const previous = index > 0 ? items[index - 1] : null
            const linked = positions[index] === 'middle' || positions[index] === 'last'
            return (
              <SupersetFrame
                key={item.we.id}
                id={cardId(item.we.id)}
                position={positions[index]}
                previousName={previous ? nameOf(previous) : null}
                name={nameOf(item)}
                hint="마지막 종목 뒤에 쉽니다"
                onToggleLink={() => {
                  if (previous) void (linked ? unlinkFromNextExercise : linkWithNextExercise)(previous.we.id)
                }}
              >
                <ExerciseCard
                  item={item}
                  mode="active"
                  live={!past}
                  index={index}
                  count={items.length}
                  onSetDone={(set) => onSetDone(item, set)}
                  recommendation={recommendOn && !past ? (recommendations.get(item.we.id) ?? null) : null}
                  records={records}
                  aiSuggestion={
                    ai.enabled && !past ? advice?.exercises.find((e) => e.workoutExerciseId === item.we.id) ?? null : null
                  }
                />
              </SupersetFrame>
            )
          })}
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
          {past ? '적기 취소' : '운동 취소'}
        </button>
      </main>

      <RestTimerBar />

      <Dialog
        open={askCancel}
        title={past ? '지난 운동 적기를 취소할까요?' : '운동을 취소할까요?'}
        onClose={() => setAskCancel(false)}
        actions={[
          { label: '취소하고 지우기', tone: 'danger', onClick: () => void cancel() },
          { label: past ? '계속 적기' : '계속 운동하기', onClick: () => setAskCancel(false) },
        ]}
      >
        지금까지 입력한 세트가 모두 지워지고 기록에 남지 않습니다.
      </Dialog>
    </>
  )
}
