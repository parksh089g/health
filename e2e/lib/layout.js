// 화면 배치 점검: 누르는 곳의 크기, 요소가 놓인 자리.

/** 손가락으로 누르기에 충분한 높이(px) */
export const TOUCH_MIN = 44

/**
 * root 안에서 보이는 누르는 곳 가운데 높이가 44px보다 낮은 것이 없는지 본다.
 * selector: 누르는 곳으로 볼 요소(기본은 버튼).
 * except: 여기에 맞는 것은 뺀다. 예: 44px 묶음 안에 든 SegmentedControl의 버튼('[role=group] button')
 */
export async function touchTargets(phone, label, root, { selector = 'button', except } = {}) {
  const small = await root.first().evaluate(
    (el, { selector, except, min }) =>
      [...el.querySelectorAll(selector)]
        .filter((target) => !(except && target.matches(except)))
        .map((target) => ({ target, height: Math.round(target.getBoundingClientRect().height) }))
        .filter(({ height }) => height > 0 && height < min)
        .map(({ target, height }) => {
          const name = target.getAttribute('aria-label') || target.textContent.trim().slice(0, 12) || target.tagName
          return `${name} ${height}px`
        }),
    { selector, except, min: TOUCH_MIN },
  )
  phone.check(small.length === 0, `${label}: 누르는 곳 ${TOUCH_MIN}px 이상${small.length ? ` (${small.join(', ')})` : ''}`)
}

/** 요소가 화면에서 차지하는 자리: { top, bottom, left, right, width, height } (px, 반올림) */
export async function boxOf(locator) {
  const box = await locator.first().boundingBox()
  if (!box) throw new Error('자리를 잴 요소가 화면에 없음')
  const round = (n) => Math.round(n)
  return {
    top: round(box.y),
    bottom: round(box.y + box.height),
    left: round(box.x),
    right: round(box.x + box.width),
    width: round(box.width),
    height: round(box.height),
  }
}
