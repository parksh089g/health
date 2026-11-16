interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  /** 접근성: 무엇을 고르는지 */
  label: string
}

/** 몇 가지 보기 중 하나를 고르는 버튼 묶음(예: 횟수 / 볼륨). */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl bg-surface-2 p-1">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={`h-9 min-w-0 flex-auto whitespace-nowrap rounded-lg px-3 text-sm font-semibold ${
              on ? 'bg-surface text-accent shadow-sm' : 'text-muted active:text-ink'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
