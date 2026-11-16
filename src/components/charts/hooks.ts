import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * 그래프를 담는 칸의 실제 폭(px). SVG를 늘이지 않고 이 폭에 맞춰 그려야 글자 크기가 그대로 유지된다.
 * 처음 그릴 때와 측정 전에는 0이다.
 */
export function useChartWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = (w: number) => setWidth(Math.floor(w))
    update(el.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => update(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * 그래프 위를 누르거나 손가락으로 좌우로 훑을 때 가장 가까운 점(막대)을 고른다.
 * 세로로 끌면 화면이 스크롤되도록 그래프에는 touch-action: pan-y를 준다.
 * 키보드는 좌우 화살표, Home, End로 움직인다.
 */
export function useScrub(opts: {
  count: number
  selected: number
  indexAt: (x: number) => number
  onSelect: (i: number) => void
}) {
  const dragging = useRef(false)
  const { count, selected, indexAt, onSelect } = opts

  const pick = (e: PointerEvent<Element>) => {
    if (count === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const i = indexAt(e.clientX - rect.left)
    if (i !== selected) onSelect(i)
  }

  const pointer = {
    onPointerDown: (e: PointerEvent<Element>) => {
      dragging.current = true
      // 손가락이 그래프 밖으로 나가도 계속 따라가게 한다.
      if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture?.(e.pointerId)
      pick(e)
    },
    onPointerMove: (e: PointerEvent<Element>) => {
      if (dragging.current || e.pointerType === 'mouse') pick(e)
    },
    onPointerUp: () => {
      dragging.current = false
    },
    onPointerCancel: () => {
      dragging.current = false
    },
  }

  const onKeyDown = (e: KeyboardEvent<Element>) => {
    if (count === 0) return
    let next: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, selected - 1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(count - 1, selected + 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = count - 1
    if (next === null) return
    e.preventDefault()
    if (next !== selected) onSelect(next)
  }

  return { pointer, onKeyDown }
}
