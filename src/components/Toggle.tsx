/** 켜고 끄는 스위치 모양. 누르는 곳은 바깥의 버튼이다. */
export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative h-8 w-14 shrink-0 rounded-full border transition-colors ${
        on ? 'border-accent bg-accent' : 'border-line bg-surface-2'
      }`}
    >
      <span
        className={`absolute top-[3px] size-6 rounded-full shadow-sm transition-[left] ${
          on ? 'left-[27px] bg-on-accent' : 'left-[3px] bg-muted'
        }`}
      />
    </span>
  )
}
