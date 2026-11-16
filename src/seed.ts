import type { BodyPart, Equipment } from './db'

export interface SeedExercise {
  id: string
  name: string
  bodyPart: BodyPart
  equipment: Equipment
}

/**
 * 기본 종목. id는 바꾸지 않는다(기록이 이 id를 가리킨다).
 * 새 종목을 여기에 더하면 앱을 열 때 자동으로 추가된다.
 */
export const SEED_EXERCISES: SeedExercise[] = [
  // 가슴
  { id: 'seed:bench-press', name: '벤치프레스', bodyPart: 'chest', equipment: 'barbell' },
  { id: 'seed:incline-bench-press', name: '인클라인 벤치프레스', bodyPart: 'chest', equipment: 'barbell' },
  { id: 'seed:dumbbell-bench-press', name: '덤벨 벤치프레스', bodyPart: 'chest', equipment: 'dumbbell' },
  { id: 'seed:incline-dumbbell-press', name: '인클라인 덤벨 프레스', bodyPart: 'chest', equipment: 'dumbbell' },
  { id: 'seed:chest-press-machine', name: '체스트 프레스 머신', bodyPart: 'chest', equipment: 'machine' },
  { id: 'seed:pec-deck-fly', name: '펙덱 플라이', bodyPart: 'chest', equipment: 'machine' },
  { id: 'seed:cable-crossover', name: '케이블 크로스오버', bodyPart: 'chest', equipment: 'cable' },
  { id: 'seed:dips', name: '딥스', bodyPart: 'chest', equipment: 'bodyweight' },
  // 등
  { id: 'seed:deadlift', name: '데드리프트', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:barbell-row', name: '바벨 로우', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:dumbbell-row', name: '덤벨 로우', bodyPart: 'back', equipment: 'dumbbell' },
  { id: 'seed:lat-pulldown', name: '랫풀다운', bodyPart: 'back', equipment: 'cable' },
  { id: 'seed:seated-cable-row', name: '시티드 로우', bodyPart: 'back', equipment: 'cable' },
  { id: 'seed:pull-up', name: '풀업', bodyPart: 'back', equipment: 'bodyweight' },
  // 하체
  { id: 'seed:squat', name: '스쿼트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:romanian-deadlift', name: '루마니안 데드리프트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:hip-thrust', name: '힙 쓰러스트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:lunge', name: '런지', bodyPart: 'legs', equipment: 'dumbbell' },
  { id: 'seed:leg-press', name: '레그 프레스', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:leg-extension', name: '레그 익스텐션', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:leg-curl', name: '레그 컬', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:calf-raise', name: '카프 레이즈', bodyPart: 'legs', equipment: 'machine' },
  // 어깨
  { id: 'seed:overhead-press', name: '오버헤드 프레스', bodyPart: 'shoulders', equipment: 'barbell' },
  { id: 'seed:dumbbell-shoulder-press', name: '덤벨 숄더 프레스', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:lateral-raise', name: '사이드 레터럴 레이즈', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:rear-delt-fly', name: '리어 델트 플라이', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:face-pull', name: '페이스 풀', bodyPart: 'shoulders', equipment: 'cable' },
  // 팔
  { id: 'seed:barbell-curl', name: '바벨 컬', bodyPart: 'arms', equipment: 'barbell' },
  { id: 'seed:dumbbell-curl', name: '덤벨 컬', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:hammer-curl', name: '해머 컬', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:cable-pushdown', name: '케이블 푸시다운', bodyPart: 'arms', equipment: 'cable' },
  { id: 'seed:lying-triceps-extension', name: '라잉 트라이셉스 익스텐션', bodyPart: 'arms', equipment: 'barbell' },
  // 코어
  { id: 'seed:crunch', name: '크런치', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:hanging-leg-raise', name: '행잉 레그 레이즈', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:cable-crunch', name: '케이블 크런치', bodyPart: 'core', equipment: 'cable' },
]
