import type { WorkoutItem } from '../lib/workouts'

interface CardToolsProps {
  item: WorkoutItem
  /** active: 운동 중, history: 지난 기록 수정 */
  mode: 'active' | 'history'
}

/**
 * 종목 카드 아래 "세트 추가" 옆에 놓이는 도구 버튼들(웜업 세트 만들기, 원판 계산).
 * 아직 비어 있다. (5단계에서 채운다)
 */
export function CardTools(_props: CardToolsProps) {
  return null
}
