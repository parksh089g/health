import type { WorkoutItem } from '../lib/workouts'

interface SupersetControlProps {
  item: WorkoutItem
  /** active: 운동 중, history: 지난 기록 수정 */
  mode: 'active' | 'history'
  /** 이 운동에서 몇 번째 종목인지(0부터)와 종목 수 */
  index: number
  count: number
}

/**
 * 종목 카드 이름 줄의 슈퍼세트 버튼 자리. 비워 둔다.
 * 이름 줄에는 옮기기와 빼기 버튼이 이미 있어 360px 화면에서 버튼을 하나 더 놓으면 종목 이름이 좁아진다.
 * 묶고 푸는 버튼은 카드와 카드 사이에 두었다(SupersetFrame). (5단계)
 */
export function SupersetControl(_props: SupersetControlProps) {
  return null
}
