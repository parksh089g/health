import type { ReactNode } from 'react'
import type { SupersetPosition } from '../lib/supersets'

interface SupersetFrameProps {
  /** 목록이 ol이면 'li' */
  as?: 'div' | 'li'
  /** 이 종목이 슈퍼세트 묶음 안에서 놓인 자리(lib/supersets.ts의 supersetPositions) */
  position: SupersetPosition
  /** 바로 위 종목의 이름. 목록의 첫 종목이면 null */
  previousName: string | null
  name: string
  /** 위 종목과 묶거나, 묶여 있으면 푼다. 주지 않으면 묶음을 보여 주기만 한다(기록 상세). */
  onToggleLink?: () => void
  /** 묶음 이름 옆에 적는 짧은 안내 */
  hint?: string
  id?: string
  ariaLabel?: string
  children: ReactNode
}

/**
 * 종목 카드 하나를 감싸서 카드 사이의 틈과 슈퍼세트 묶음을 그린다.
 * 묶인 카드들은 옅은 바탕 하나에 이어 담기고 맨 위에 "슈퍼세트"라고 적힌다.
 * 묶고 푸는 버튼은 카드와 카드 사이에 둔다. 카드의 이름 줄에는 옮기기와 빼기 버튼이 이미 있어서,
 * 거기에 버튼을 더하면 360px 화면에서 종목 이름이 들어갈 자리가 너무 좁아진다.
 */
export function SupersetFrame({
  as: Tag = 'div',
  position,
  previousName,
  name,
  onToggleLink,
  hint,
  id,
  ariaLabel,
  children,
}: SupersetFrameProps) {
  const linkedAbove = position === 'middle' || position === 'last'
  const joint = previousName !== null && (
    <Joint linked={linkedAbove} names={`${previousName}, ${name}`} onToggle={onToggleLink} />
  )
  const tray =
    position === 'none'
      ? undefined
      : `-mx-1.5 bg-accent-soft px-1.5 ${position === 'first' ? 'rounded-t-[22px]' : ''} ${
          position === 'last' ? 'rounded-b-[22px] pb-1.5' : ''
        }`

  return (
    <Tag id={id} aria-label={ariaLabel} className="scroll-my-20">
      {!linkedAbove && joint}
      <div className={tray} data-superset={position === 'none' ? undefined : position}>
        {position === 'first' && (
          <p className="flex h-8 items-center gap-1.5 px-2.5 text-xs">
            <LinkGlyph linked className="size-3.5 shrink-0 text-accent" />
            <span className="shrink-0 font-bold text-accent">슈퍼세트</span>
            {hint && <span className="min-w-0 truncate text-muted">{hint}</span>}
          </p>
        )}
        {linkedAbove && joint}
        {children}
      </div>
    </Tag>
  )
}

interface JointProps {
  /** 위아래 종목이 묶여 있는지 */
  linked: boolean
  /** "위 종목, 아래 종목" */
  names: string
  onToggle?: () => void
}

/**
 * 카드와 카드 사이의 틈. 버튼은 틈에 걸쳐 놓인 작은 알약 모양이고,
 * 누르는 곳은 위아래 카드의 여백까지 넓혀 44px를 채운다(틈 자체는 20px만 차지한다).
 */
function Joint({ linked, names, onToggle }: JointProps) {
  if (!onToggle) return <div className="h-3" />
  return (
    <div className="relative h-5">
      <button
        type="button"
        onClick={onToggle}
        aria-label={`${names} ${linked ? '슈퍼세트 묶음 풀기' : '슈퍼세트로 묶기'}`}
        className="group absolute left-1/2 top-1/2 z-[1] flex h-11 -translate-x-1/2 -translate-y-1/2 items-center px-4"
      >
        <span
          className={`flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold group-active:opacity-60 ${
            linked ? 'border-accent bg-surface text-accent' : 'border-line bg-bg text-muted'
          }`}
        >
          <LinkGlyph linked={!linked} className="size-3.5" />
          {linked ? '묶음 풀기' : '슈퍼세트로 묶기'}
        </span>
      </button>
    </div>
  )
}

/** 이어진 고리(linked)와 끊어진 고리 */
function LinkGlyph({ linked, className }: { linked: boolean; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2" />
      {linked && <path d="M8 12h8" />}
    </svg>
  )
}
