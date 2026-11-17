/**
 * 운동 중 화면과 지난 기록 화면에서 세트 줄의 칸 나눔. 머리글 줄(ExerciseCard)과 세트 줄(SetRow)이 같이 쓴다.
 * 유산소 종목도 같은 칸을 쓴다(무게와 횟수 자리에 시간과 거리나 층수. 시간만 적는 종목은 시간이 두 칸을 다 쓴다).
 */
export function setRowColumns(mode: 'active' | 'history'): string {
  return mode === 'active' ? 'grid-cols-[3rem_1fr_1fr_3rem]' : 'grid-cols-[3rem_1fr_1fr]'
}
