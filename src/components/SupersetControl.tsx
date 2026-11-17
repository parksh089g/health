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
 * 종목 카드 이름 줄에 놓이는 슈퍼세트 버튼(다음 종목과 묶기, 풀기).
 * 아직 비어 있다. (5단계에서 채운다)
 */
export function SupersetControl(_props: SupersetControlProps) {
  return null
}
