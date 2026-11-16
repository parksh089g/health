import type { BodyPart, Equipment } from './db'

export interface SeedExercise {
  id: string
  name: string
  bodyPart: BodyPart
  equipment: Equipment
}

/**
 * 기본 종목. id는 바꾸지 않는다(기록이 이 id를 가리킨다).
 * 새 종목을 여기에 더하면 앱을 열 때 자동으로 추가된다. 같은 이름의 내 종목이 이미 있으면 그 종목을 그대로 쓴다.
 * 무게를 덜어 주는 종목(어시스트 풀업 머신 등)과 시간으로 재는 종목(플랭크 등)은 추천과 기록 계산이 맞지 않아 넣지 않는다.
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
  { id: 'seed:decline-bench-press', name: '디클라인 벤치프레스', bodyPart: 'chest', equipment: 'barbell' },
  { id: 'seed:smith-bench-press', name: '스미스 머신 벤치프레스', bodyPart: 'chest', equipment: 'machine' },
  { id: 'seed:dumbbell-fly', name: '덤벨 플라이', bodyPart: 'chest', equipment: 'dumbbell' },
  { id: 'seed:push-up', name: '푸시업', bodyPart: 'chest', equipment: 'bodyweight' },
  // 등
  { id: 'seed:deadlift', name: '데드리프트', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:barbell-row', name: '바벨 로우', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:dumbbell-row', name: '덤벨 로우', bodyPart: 'back', equipment: 'dumbbell' },
  { id: 'seed:lat-pulldown', name: '랫풀다운', bodyPart: 'back', equipment: 'cable' },
  { id: 'seed:seated-cable-row', name: '시티드 로우', bodyPart: 'back', equipment: 'cable' },
  { id: 'seed:pull-up', name: '풀업', bodyPart: 'back', equipment: 'bodyweight' },
  { id: 'seed:sumo-deadlift', name: '스모 데드리프트', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:t-bar-row', name: '티바 로우', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:machine-row', name: '머신 로우', bodyPart: 'back', equipment: 'machine' },
  { id: 'seed:straight-arm-pulldown', name: '스트레이트 암 풀다운', bodyPart: 'back', equipment: 'cable' },
  { id: 'seed:chin-up', name: '친업', bodyPart: 'back', equipment: 'bodyweight' },
  { id: 'seed:back-extension', name: '백 익스텐션', bodyPart: 'back', equipment: 'bodyweight' },
  { id: 'seed:barbell-shrug', name: '바벨 슈러그', bodyPart: 'back', equipment: 'barbell' },
  { id: 'seed:dumbbell-shrug', name: '덤벨 슈러그', bodyPart: 'back', equipment: 'dumbbell' },
  // 하체
  { id: 'seed:squat', name: '스쿼트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:romanian-deadlift', name: '루마니안 데드리프트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:hip-thrust', name: '힙 쓰러스트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:lunge', name: '런지', bodyPart: 'legs', equipment: 'dumbbell' },
  { id: 'seed:leg-press', name: '레그 프레스', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:leg-extension', name: '레그 익스텐션', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:leg-curl', name: '레그 컬', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:calf-raise', name: '카프 레이즈', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:stiff-leg-deadlift', name: '스티프 데드리프트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:dumbbell-romanian-deadlift', name: '덤벨 루마니안 데드리프트', bodyPart: 'legs', equipment: 'dumbbell' },
  { id: 'seed:good-morning', name: '굿모닝', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:front-squat', name: '프론트 스쿼트', bodyPart: 'legs', equipment: 'barbell' },
  { id: 'seed:smith-squat', name: '스미스 머신 스쿼트', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:hack-squat', name: '핵 스쿼트', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:goblet-squat', name: '고블릿 스쿼트', bodyPart: 'legs', equipment: 'dumbbell' },
  { id: 'seed:bulgarian-split-squat', name: '불가리안 스플릿 스쿼트', bodyPart: 'legs', equipment: 'dumbbell' },
  { id: 'seed:hip-abduction', name: '힙 어브덕션', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:hip-adduction', name: '힙 어덕션', bodyPart: 'legs', equipment: 'machine' },
  { id: 'seed:cable-glute-kickback', name: '케이블 글루트 킥백', bodyPart: 'legs', equipment: 'cable' },
  { id: 'seed:seated-calf-raise', name: '시티드 카프 레이즈', bodyPart: 'legs', equipment: 'machine' },
  // 어깨
  { id: 'seed:overhead-press', name: '오버헤드 프레스', bodyPart: 'shoulders', equipment: 'barbell' },
  { id: 'seed:dumbbell-shoulder-press', name: '덤벨 숄더 프레스', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:lateral-raise', name: '사이드 레터럴 레이즈', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:rear-delt-fly', name: '리어 델트 플라이', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:face-pull', name: '페이스 풀', bodyPart: 'shoulders', equipment: 'cable' },
  { id: 'seed:arnold-press', name: '아놀드 프레스', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:shoulder-press-machine', name: '숄더 프레스 머신', bodyPart: 'shoulders', equipment: 'machine' },
  { id: 'seed:front-raise', name: '프론트 레이즈', bodyPart: 'shoulders', equipment: 'dumbbell' },
  { id: 'seed:cable-lateral-raise', name: '케이블 레터럴 레이즈', bodyPart: 'shoulders', equipment: 'cable' },
  { id: 'seed:upright-row', name: '업라이트 로우', bodyPart: 'shoulders', equipment: 'barbell' },
  { id: 'seed:reverse-pec-deck', name: '리버스 펙덱 플라이', bodyPart: 'shoulders', equipment: 'machine' },
  // 팔
  { id: 'seed:barbell-curl', name: '바벨 컬', bodyPart: 'arms', equipment: 'barbell' },
  { id: 'seed:dumbbell-curl', name: '덤벨 컬', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:hammer-curl', name: '해머 컬', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:cable-pushdown', name: '케이블 푸시다운', bodyPart: 'arms', equipment: 'cable' },
  { id: 'seed:lying-triceps-extension', name: '라잉 트라이셉스 익스텐션', bodyPart: 'arms', equipment: 'barbell' },
  { id: 'seed:ez-bar-curl', name: '이지바 컬', bodyPart: 'arms', equipment: 'barbell' },
  { id: 'seed:preacher-curl', name: '프리처 컬', bodyPart: 'arms', equipment: 'barbell' },
  { id: 'seed:incline-dumbbell-curl', name: '인클라인 덤벨 컬', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:concentration-curl', name: '컨센트레이션 컬', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:cable-curl', name: '케이블 컬', bodyPart: 'arms', equipment: 'cable' },
  { id: 'seed:close-grip-bench-press', name: '클로즈 그립 벤치프레스', bodyPart: 'arms', equipment: 'barbell' },
  { id: 'seed:overhead-triceps-extension', name: '오버헤드 트라이셉스 익스텐션', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:triceps-kickback', name: '트라이셉스 킥백', bodyPart: 'arms', equipment: 'dumbbell' },
  { id: 'seed:bench-dips', name: '벤치 딥스', bodyPart: 'arms', equipment: 'bodyweight' },
  // 코어
  { id: 'seed:crunch', name: '크런치', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:hanging-leg-raise', name: '행잉 레그 레이즈', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:cable-crunch', name: '케이블 크런치', bodyPart: 'core', equipment: 'cable' },
  { id: 'seed:sit-up', name: '싯업', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:leg-raise', name: '레그 레이즈', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:russian-twist', name: '러시안 트위스트', bodyPart: 'core', equipment: 'bodyweight' },
  { id: 'seed:ab-rollout', name: '앱 롤아웃', bodyPart: 'core', equipment: 'bodyweight' },
]
