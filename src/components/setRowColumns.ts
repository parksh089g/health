/** 운동 중 화면과 지난 기록 화면에서 세트 줄의 칸 나눔. 머리글 줄(ExerciseCard)과 세트 줄(SetRow)이 같이 쓴다. */
export function setRowColumns(mode: 'active' | 'history'): string {
  return mode === 'active' ? 'grid-cols-[3rem_1fr_1fr_3rem]' : 'grid-cols-[3rem_1fr_1fr]'
}
