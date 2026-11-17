import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { SetEntry } from '../db'
import { formatKg } from '../lib/format'
import { describePlateLoad, distinctWeights, platesFor, type PlateSetup } from '../lib/plates'
import { usePlateSetup } from '../lib/usePlateSetup'
import { NumberField } from './NumberField'

interface PlateSheetProps {
  /** 종목 이름 */
  name: string
  /** 이 종목의 세트. 적힌 무게마다 원판을 보여 준다. */
  sets: SetEntry[]
  /** 바깥이나 닫기를 누르거나 Esc를 눌렀을 때 */
  onClose: () => void
}

/**
 * 원판 계산 창. 바벨 종목 카드의 "원판"을 누르면 아래에서 올라온다.
 * 세트에 적힌 무게마다 한쪽에 끼울 원판을 보여 주고, 다른 무게도 적어 볼 수 있다.
 */
export function PlateSheet({ name, sets, onClose }: PlateSheetProps) {
  const setup = usePlateSetup()
  const [other, setOther] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 설정을 읽어 오는 동안(아주 잠깐)은 그리지 않는다.
  if (!setup) return null

  const weights = distinctWeights(sets)

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="원판 계산"
        className="max-h-full w-full max-w-sm overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-baseline gap-2 text-lg font-bold text-ink">
          <span className="shrink-0">원판 계산</span>
          <span className="min-w-0 truncate text-[15px] font-medium text-muted">{name}</span>
        </h2>
        <p className="mt-1 break-keep text-sm leading-snug text-muted">
          바 {formatKg(setup.barKg)}kg에 한쪽마다 끼울 원판입니다. 원판 {setup.plates.map(formatKg).join(', ')}kg
        </p>

        {weights.length > 0 ? (
          <ul className="mt-3 divide-y divide-line border-y border-line" aria-label="세트 무게별 원판">
            {weights.map((kg) => (
              <li key={kg}>
                <PlateRow weightKg={kg} setup={setup} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 border-y border-line py-3 text-[15px] text-muted">세트에 무게를 적으면 여기에 나옵니다.</p>
        )}

        <p className="mt-3 text-[15px] font-semibold text-ink">다른 무게</p>
        <div className="mt-1.5 grid grid-cols-[6.5rem_1fr] items-center gap-3">
          <NumberField decimal value={other} onChange={setOther} unit="kg" ariaLabel="다른 무게" />
          {other !== null && other > 0 ? (
            <PlateText weightKg={other} setup={setup} live />
          ) : (
            <p className="break-keep text-sm leading-snug text-muted">무게를 적으면 원판을 계산합니다.</p>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {/* 바 무게와 가진 원판은 설정 화면에서 바꾼다. 뒤로 가면 이 운동으로 돌아온다. */}
          <Link
            to="/settings"
            state={{ focus: 'plates' }}
            className="flex h-12 items-center justify-center rounded-xl bg-surface-2 text-base font-semibold text-ink active:opacity-80"
          >
            바·원판 설정
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="h-12 rounded-xl bg-surface-2 text-base font-semibold text-ink active:opacity-80"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}

interface PlateRowProps {
  weightKg: number
  setup: PlateSetup
}

/** 무게 하나의 줄: 무게, 한쪽 원판 글, 바에 끼운 그림 */
function PlateRow({ weightKg, setup }: PlateRowProps) {
  const load = platesFor(weightKg, setup)
  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <p className="w-[4.25rem] shrink-0 text-base font-bold tabular-nums text-ink">{formatKg(weightKg)}kg</p>
      <div className="min-w-0 flex-1">
        <PlateText weightKg={weightKg} setup={setup} />
      </div>
      {load.perSide.length > 0 && <PlateDrawing perSide={load.perSide} />}
    </div>
  )
}

/** "한쪽에 25 + 15"와, 딱 맞지 않을 때의 덧붙임 */
function PlateText({ weightKg, setup, live = false }: PlateRowProps & { live?: boolean }) {
  const load = platesFor(weightKg, setup)
  const { main, note } = describePlateLoad(load, setup.barKg)
  return (
    <div role={live ? 'status' : undefined} className="min-w-0">
      <p className={`text-[15px] leading-snug tabular-nums ${load.belowBar ? 'text-muted' : 'font-semibold text-ink'}`}>
        {main}
      </p>
      {note && <p className="mt-0.5 break-keep text-sm leading-snug text-muted">{note}</p>}
    </div>
  )
}

/** 그림에서 원판의 높이(지름). 무거울수록 크다. */
function plateHeight(kg: number): number {
  return Math.round(14 + 30 * Math.sqrt(Math.min(kg, 25) / 25))
}

/** 그림에서 원판의 두께 */
function plateWidth(kg: number): number {
  return kg >= 10 ? 8 : kg >= 5 ? 6 : 5
}

/**
 * 바의 한쪽에 원판을 끼운 그림(안쪽부터 무거운 순서). 무게는 옆의 글이 알려 주고 그림은 거들 뿐이라 읽어 주지 않는다.
 */
function PlateDrawing({ perSide }: { perSide: number[] }) {
  const HEIGHT = 48
  const mid = HEIGHT / 2
  const rects: { x: number; w: number; h: number }[] = []
  let x = 20
  for (const kg of perSide) {
    const w = plateWidth(kg)
    rects.push({ x, w, h: plateHeight(kg) })
    x += w + 2
  }
  const width = x + 8
  return (
    <svg
      viewBox={`0 0 ${width} ${HEIGHT}`}
      aria-hidden="true"
      className="h-10 max-w-24 shrink-0"
      style={{ aspectRatio: `${width} / ${HEIGHT}` }}
    >
      {/* 바(손잡이 쪽)와 원판이 걸리는 턱, 원판 바깥으로 남는 끝 */}
      <rect x="0" y={mid - 2} width="14" height="4" rx="1" className="fill-muted" />
      <rect x="13" y={mid - 6} width="5" height="12" rx="1.5" className="fill-muted" />
      <rect x="18" y={mid - 3} width={width - 18} height="6" rx="2" className="fill-muted" />
      {rects.map((r, i) => (
        <rect key={i} x={r.x} y={mid - r.h / 2} width={r.w} height={r.h} rx="2" className="fill-accent" />
      ))}
    </svg>
  )
}
