import { useState, type Ref } from 'react'

interface NumberFieldProps {
  value: number | null
  onChange: (value: number | null) => void
  /** 소수(0.25 단위까지) 입력을 받을지. 무게는 true, 횟수는 false. */
  decimal?: boolean
  unit: string
  ariaLabel: string
  inputRef?: Ref<HTMLInputElement>
  dimmed?: boolean
  /** 비어 있을 때 보이는 글자. 기본은 "0" */
  placeholder?: string
  /** 정수 부분의 최대 자릿수. 기본은 3(999까지). 층수처럼 더 큰 값을 받는 칸에서만 늘린다. */
  maxDigits?: number
}

const DEFAULT_MAX_DIGITS = 3

/** 받을 수 있는 글자 모양. 소수는 둘째 자리까지 */
function pattern(decimal: boolean, maxDigits: number): RegExp {
  return new RegExp(decimal ? `^\\d{0,${maxDigits}}(\\.\\d{0,2})?$` : `^\\d{0,${maxDigits}}$`)
}

function toText(value: number | null): string {
  return value === null ? '' : String(value)
}

/**
 * 숫자 입력 칸. 입력하는 동안에는 친 글자를 그대로 보여 주고("62." 같은 중간 상태 포함),
 * 값은 바뀔 때마다 바로 올려 보낸다.
 */
export function NumberField({
  value,
  onChange,
  decimal = false,
  unit,
  ariaLabel,
  inputRef,
  dimmed,
  placeholder = '0',
  maxDigits = DEFAULT_MAX_DIGITS,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? toText(value)

  const handleChange = (raw: string) => {
    const next = raw.replace(',', '.')
    if (!pattern(decimal, maxDigits).test(next)) return
    setDraft(next)
    if (next === '' || next === '.') onChange(null)
    else onChange(Number(next))
  }

  return (
    <label
      className={`flex h-12 min-w-0 items-center rounded-xl border border-line bg-bg px-2 focus-within:border-accent ${dimmed ? 'opacity-70' : ''}`}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode={decimal ? 'decimal' : 'numeric'}
        enterKeyHint="done"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          setDraft(toText(value))
          e.currentTarget.select()
        }}
        onBlur={() => setDraft(null)}
        onChange={(e) => handleChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-full min-w-0 bg-transparent text-right text-lg font-semibold tabular-nums text-ink outline-none placeholder:text-muted/60"
      />
      <span className="ml-1 shrink-0 text-sm text-muted">{unit}</span>
    </label>
  )
}
