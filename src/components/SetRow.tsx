import { useRef, useState } from 'react'
import type { SetEntry } from '../db'
import { isSetEntered } from '../lib/measure'
import { completeSet, removeSet, updateSet } from '../lib/workouts'
import { Dialog } from './Dialog'
import { CheckIcon } from './icons'
import { NumberField } from './NumberField'
import { PrBadge } from './PrBadge'
import { SetSheet } from './SetSheet'

interface SetRowProps {
  set: SetEntry
  label: string
  mode: 'active' | 'history'
  columns: string
  /** 시간 종목이면 횟수 칸 대신 시간(초) 칸을 둔다. */
  timed: boolean
  /** 맨몸 종목이면 무게 칸이 추가 무게다. */
  addedWeight: boolean
  onDone?: () => void
  /** 이 세트로 새로 세운 기록의 이름. 비어 있으면 PR 표시가 없다. */
  recordLabels: string[]
}

/** 세트 한 줄: 번호(설정 창), 무게, 횟수나 시간, 완료 체크. */
export function SetRow({ set, label, mode, columns, timed, addedWeight, onDone, recordLabels }: SetRowProps) {
  // 횟수 칸(시간 종목이면 시간 칸)
  const amountRef = useRef<HTMLInputElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [askDelete, setAskDelete] = useState(false)
  const done = mode === 'active' && set.isDone
  const rpe = set.rpe ?? null
  const setName = set.isWarmup ? '웜업 세트' : `${label}세트`

  const openSheet = () => {
    // 키보드가 올라와 있으면 아래에서 뜨는 창을 가리므로 먼저 내린다.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    setSheetOpen(true)
  }

  // 완료한 세트는 기록이라 한 번 더 묻고, 아직 하지 않은 세트는 바로 지운다.
  const requestDelete = () => {
    setSheetOpen(false)
    if (set.isDone) setAskDelete(true)
    else void removeSet(set.id)
  }

  /** 완료로 바뀐 뒤: 휴식 타이머가 가려지지 않게 키보드를 내리고 바깥에 알린다. */
  const afterDone = () => {
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    onDone?.()
  }

  const toggleDone = () => {
    if (set.isDone) {
      void updateSet(set.id, { isDone: false })
      return
    }
    if (isSetEntered(set)) {
      void updateSet(set.id, { isDone: true })
      afterDone()
      return
    }
    // 횟수(시간 종목이면 시간)가 없으면 완료로 표시하지 않고 그 칸으로 보낸다.
    amountRef.current?.focus()
    // 다만 방금 친 값이 아직 화면까지 돌아오지 않았을 수 있으니, 저장된 값으로 한 번 더 확인한다.
    void completeSet(set.id).then((ok) => {
      if (ok) afterDone()
    })
  }

  const changeAmount = (value: number | null) => {
    const amount = timed ? { durationSec: value } : { reps: value }
    // 운동 중에 횟수(시간)를 지우면 완료 표시도 함께 푼다.
    const clearsDone = mode === 'active' && set.isDone && (value ?? 0) <= 0
    void updateSet(set.id, clearsDone ? { ...amount, isDone: false } : amount)
  }

  return (
    <div className={`grid ${columns} items-center gap-2`}>
      <div className="relative">
        {/* 번호를 누르면 이 세트의 설정 창(웜업, RPE, 삭제)이 열린다. 적어 둔 RPE는 번호 아래에 보인다. */}
        <button
          type="button"
          onClick={openSheet}
          aria-haspopup="dialog"
          aria-label={`${setName} 설정${rpe === null ? '' : `, RPE ${rpe}`}`}
          className={`flex h-12 w-full flex-col items-center justify-center rounded-xl active:opacity-70 ${
            set.isWarmup ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink'
          }`}
        >
          <span className="text-base font-bold leading-5">{label}</span>
          {rpe === null ? (
            <span aria-hidden="true" className="text-[11px] font-bold leading-3 tracking-widest text-muted">
              ···
            </span>
          ) : (
            <span className="text-[11px] font-semibold leading-3 tabular-nums">RPE {rpe}</span>
          )}
        </button>
        {/* 자리를 차지하지 않게 겹쳐 그려서, 표시가 생기거나 사라져도 세트 줄이 움직이지 않는다. */}
        {recordLabels.length > 0 && (
          <PrBadge labels={recordLabels} className="pointer-events-none absolute -right-1.5 -top-1.5 shadow-sm" />
        )}
      </div>
      <NumberField
        decimal
        unit="kg"
        ariaLabel={`${label}세트 ${addedWeight ? '추가 무게' : '무게'}`}
        value={set.weightKg}
        onChange={(weightKg) => void updateSet(set.id, { weightKg })}
        dimmed={done}
      />
      <NumberField
        unit={timed ? '초' : '회'}
        ariaLabel={`${label}세트 ${timed ? '시간' : '횟수'}`}
        value={timed ? (set.durationSec ?? null) : set.reps}
        onChange={changeAmount}
        inputRef={amountRef}
        dimmed={done}
      />
      {mode === 'active' && (
        <button
          type="button"
          onClick={toggleDone}
          aria-pressed={set.isDone}
          aria-label={`${label}세트 완료`}
          className={`flex size-12 items-center justify-center rounded-full border-2 active:scale-95 ${
            set.isDone ? 'border-good bg-good text-white' : 'border-line bg-bg text-muted'
          }`}
        >
          <CheckIcon className="size-6" />
        </button>
      )}

      <SetSheet
        open={sheetOpen}
        set={set}
        label={label}
        addedWeight={addedWeight}
        onClose={() => setSheetOpen(false)}
        onDelete={requestDelete}
      />
      <Dialog
        open={askDelete}
        title={`${setName}를 삭제할까요?`}
        onClose={() => setAskDelete(false)}
        actions={[
          { label: '삭제', tone: 'danger', onClick: () => void removeSet(set.id) },
          { label: '취소', onClick: () => setAskDelete(false) },
        ]}
      >
        완료한 세트 기록이 지워집니다.
      </Dialog>
    </div>
  )
}
