import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import type { Exercise } from '../db'
import { getExerciseUsage, removalKind, removeExercise, restoreExercise, updateCustomExercise } from '../lib/exercises'
import { measureOf } from '../lib/measure'
import { Dialog } from './Dialog'
import { ExerciseForm } from './ExerciseForm'

interface ExerciseManageProps {
  exercise: Exercise
  /** 종목을 지웠거나 숨긴 뒤에 부른다. */
  onRemoved?: (result: 'deleted' | 'archived') => void
}

const BUTTON = 'h-11 min-w-0 flex-1 rounded-xl px-3 text-[15px] font-semibold active:opacity-70 disabled:opacity-40'

/**
 * 종목 관리: 내 종목의 이름, 부위, 기구, 재는 방법(횟수/시간)을 바꾸고, 종목을 지우거나 숨기고, 숨긴 종목을 다시 보이게 한다.
 * 기록이 없는 내 종목만 정말 지우고(되돌릴 수 없어 한 번 묻는다), 그 밖에는 숨긴다(언제든 되돌릴 수 있어 묻지 않는다).
 * 종목 상세와 종목 선택 목록이 함께 쓴다.
 */
export function ExerciseManage({ exercise, onRemoved }: ExerciseManageProps) {
  const usage = useLiveQuery(() => getExerciseUsage(exercise.id), [exercise.id])
  const [editing, setEditing] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (work: Promise<unknown>) => {
    setError(null)
    work.catch((e: unknown) => setError(e instanceof Error ? e.message : '처리하지 못했습니다.'))
  }

  const remove = () => {
    setAskDelete(false)
    run(removeExercise(exercise.id).then((result) => onRemoved?.(result)))
  }

  if (editing) {
    return (
      <ExerciseForm
        bare
        title="이름·부위·기구 바꾸기"
        submitLabel="저장"
        initial={{
          name: exercise.name,
          bodyPart: exercise.bodyPart,
          equipment: exercise.equipment,
          measure: measureOf(exercise),
        }}
        // 기록(진행 중인 운동 포함)이 있으면 횟수와 시간을 바꿀 수 없다. 세는 동안에도 잠가 둔다.
        measureLocked={usage === undefined || usage.records > 0}
        onSubmit={async (input) => {
          await updateCustomExercise(exercise.id, input)
          setEditing(false)
        }}
        onCancel={() => setEditing(false)}
      />
    )
  }

  // 기본 종목은 언제나 숨긴다. 내 종목은 기록을 세어 봐야 지울지 숨길지 안다(세는 동안은 null).
  const kind = !exercise.isCustom ? 'archive' : usage === undefined ? null : removalKind(exercise, usage.records)
  const archived = exercise.archived === true
  const removeLabel = kind === 'delete' ? '지우기' : archived ? null : '숨기기'
  // 옆에 다른 버튼이 있으면 좁게 그린다.
  const alone = !exercise.isCustom && !archived

  return (
    <>
      <div className="flex gap-2">
        {exercise.isCustom && (
          <button type="button" onClick={() => setEditing(true)} className={`${BUTTON} bg-surface-2 text-ink`}>
            이름·부위·기구 바꾸기
          </button>
        )}
        {archived && (
          <button
            type="button"
            onClick={() => run(restoreExercise(exercise.id))}
            className={`${BUTTON} bg-accent-soft text-accent`}
          >
            다시 보이기
          </button>
        )}
        {removeLabel && (
          <button
            type="button"
            onClick={kind === 'delete' ? () => setAskDelete(true) : remove}
            // 세는 동안에는 자리만 잡아 둔다(글자가 "숨기기"에서 "지우기"로 바뀌어 보이지 않게).
            className={`${BUTTON} bg-surface-2 ${kind === 'delete' ? 'text-danger' : 'text-ink'} ${alone ? '' : 'max-w-24'} ${
              kind === null ? 'invisible' : ''
            }`}
          >
            {removeLabel}
          </button>
        )}
      </div>
      <p className="mt-2 min-h-9 text-xs leading-relaxed text-muted">
        {archived
          ? '숨긴 종목은 종목 선택에 나오지 않습니다. 지난 기록과 통계, 루틴에는 그대로 남아 있습니다.'
          : kind === 'delete'
            ? '아직 기록이 없는 내 종목이라 완전히 지울 수 있습니다.'
            : kind === null
              ? ''
              : exercise.isCustom
                ? '기록이 있는 종목은 지우지 않고 숨깁니다. 종목 선택에는 나오지 않고, 지난 기록과 통계, 루틴에는 그대로 남습니다.'
                : '숨기면 종목 선택에 나오지 않습니다. 지난 기록과 통계, 루틴에는 그대로 남고, 언제든 다시 보이게 할 수 있습니다.'}
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}

      <Dialog
        open={askDelete}
        title={`${exercise.name} 지우기`}
        onClose={() => setAskDelete(false)}
        actions={[
          { label: '지우기', tone: 'danger', onClick: remove },
          { label: '취소', onClick: () => setAskDelete(false) },
        ]}
      >
        이 종목이 완전히 지워지고 되돌릴 수 없습니다.
        {usage !== undefined && usage.routines > 0 && ` 이 종목이 들어 있는 루틴 ${usage.routines}개에서도 빠집니다.`}
      </Dialog>
    </>
  )
}
