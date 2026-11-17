import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { formatKg } from '../lib/format'
import { BAR_OPTIONS, BAR_RANGE, PLATE_OPTIONS, isBarWeight } from '../lib/plates'
import { SETTING_KEYS, setSetting } from '../lib/settings'
import { usePlateSetup } from '../lib/usePlateSetup'
import { NumberField } from './NumberField'

/**
 * 설정 화면의 바 무게와 가진 원판 칸.
 * 원판 계산과 웜업 세트 만들기가 이 값을 쓴다.
 */
export function PlateSettings() {
  const setup = usePlateSetup()
  const sectionRef = useRef<HTMLElement>(null)
  const [keepOne, setKeepOne] = useState(false)
  // 원판 계산 창의 "바와 원판 설정"으로 넘어왔으면 이 칸이 보이게 내려간다.
  // 위의 칸들이 저장된 값을 읽어 오며 높이가 바뀔 수 있어, 이 칸의 값이 읽힌 뒤에 한 번 더 맞춘다.
  const focus = (useLocation().state as { focus?: string } | null)?.focus === 'plates'
  const navigate = useNavigate()
  const loaded = setup !== undefined
  useEffect(() => {
    if (focus) sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [focus, loaded])

  const togglePlate = (kg: number) => {
    if (!setup) return
    const on = setup.plates.includes(kg)
    const next = PLATE_OPTIONS.filter((p) => (p === kg ? !on : setup.plates.includes(p)))
    // 원판을 모두 끄면 계산할 수 없으니 마지막 하나는 남긴다.
    setKeepOne(next.length === 0)
    if (next.length > 0) void setSetting(SETTING_KEYS.plates, next)
  }

  return (
    <section
      ref={sectionRef}
      className="mt-4 scroll-mt-4 rounded-2xl border border-line bg-surface p-4"
      aria-label="바와 원판"
    >
      <h2 className="font-bold text-ink">바와 원판</h2>
      <p className="mt-1 break-keep text-sm leading-relaxed text-muted">
        바벨 종목의 원판 계산과 웜업 세트를 만들 때 씁니다. 헬스장에 있는 것에 맞춰 주세요.
      </p>

      <h3 className="mt-4 text-[15px] font-semibold text-ink">바 무게</h3>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {BAR_OPTIONS.map((kg) => (
          <button
            key={kg}
            type="button"
            aria-pressed={setup?.barKg === kg}
            onClick={() => void setSetting(SETTING_KEYS.barWeightKg, kg)}
            className={`h-12 rounded-xl text-base font-semibold active:opacity-70 ${
              setup?.barKg === kg ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
            }`}
          >
            {kg}kg
          </button>
        ))}
      </div>
      {setup && <BarDirectInput barKg={setup.barKg} />}

      <h3 id="plate-toggle-title" className="mt-4 text-[15px] font-semibold text-ink">
        가진 원판
      </h3>
      <div role="group" aria-labelledby="plate-toggle-title" className="mt-2 grid grid-cols-4 gap-2">
        {PLATE_OPTIONS.map((kg) => {
          const on = setup?.plates.includes(kg) ?? false
          return (
            <button
              key={kg}
              type="button"
              aria-pressed={on}
              aria-label={`${formatKg(kg)}kg 원판`}
              disabled={!setup}
              onClick={() => togglePlate(kg)}
              className={`h-12 rounded-xl text-base font-semibold tabular-nums active:opacity-70 ${
                on ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted'
              }`}
            >
              {formatKg(kg)}
            </button>
          )
        })}
      </div>
      <p
        role={keepOne ? 'alert' : undefined}
        className={`mt-2 break-keep text-sm leading-relaxed ${keepOne ? 'text-danger' : 'text-muted'}`}
      >
        {keepOne ? '원판은 하나 이상 켜 두어야 합니다.' : '한 장의 무게(kg)입니다. 없는 원판은 눌러서 끕니다.'}
      </p>
      {/* 원판 계산 창에서 넘어왔으면 하던 운동으로 바로 돌아갈 수 있게 한다. */}
      {focus && (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-4 h-12 w-full rounded-xl bg-accent font-semibold text-on-accent active:opacity-80"
        >
          운동으로 돌아가기
        </button>
      )}
    </section>
  )
}

/**
 * 바 무게를 직접 적는 칸. 범위 안의 값이면 바로 저장한다.
 * 적는 동안의 중간 값(12.5를 적다 만 12)도 저장되므로, 비우거나 맞지 않는 값을 남기고 칸을 떠나면 적기 전 값으로 되돌린다.
 * (설정 화면의 휴식 시간 직접 입력과 같은 방식이다.)
 */
function BarDirectInput({ barKg }: { barKg: number }) {
  const [value, setValue] = useState<number | null>(barKg)
  // 위의 버튼으로 바 무게가 바뀌면 칸의 값도 따라간다(적는 중에 저장된 값이면 그대로 둔다).
  const [seen, setSeen] = useState(barKg)
  const [sent, setSent] = useState<number | null>(null)
  // 마지막으로 제대로 정한 값
  const [committed, setCommitted] = useState(barKg)
  if (seen !== barKg) {
    setSeen(barKg)
    if (barKg !== sent) {
      setCommitted(barKg)
      if (value !== barKg) setValue(barKg)
    }
  }
  const invalid = value !== null && !isBarWeight(value)

  const store = (v: number) => {
    setSent(v)
    void setSetting(SETTING_KEYS.barWeightKg, v)
  }

  const change = (v: number | null) => {
    setValue(v)
    if (isBarWeight(v) && v !== barKg) store(v)
  }

  const leave = () => {
    if (isBarWeight(value)) {
      setCommitted(value)
      return
    }
    setValue(committed)
    if (committed !== barKg) store(committed)
  }

  return (
    <div className="mt-3 grid grid-cols-2 items-center gap-3" onBlur={leave}>
      <NumberField
        decimal
        value={value}
        onChange={change}
        unit="kg"
        ariaLabel="바 무게 직접 입력"
        placeholder={formatKg(barKg)}
      />
      <p role={invalid ? 'alert' : undefined} className={`text-sm ${invalid ? 'text-danger' : 'text-muted'}`}>
        {invalid ? `${BAR_RANGE.min}~${BAR_RANGE.max}kg로 정해 주세요.` : '직접 입력'}
      </p>
    </div>
  )
}
