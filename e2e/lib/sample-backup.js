// 샘플 기록: 약 10주 동안 운동 30번을 담은 백업 파일(fixtures/sample-backup.json).
// 파일의 날짜는 만든 때에 멈춰 있어서, 쓸 때마다 마지막 운동이 어제가 되도록 통째로 옮긴다.
// 그래야 언제 돌려도 "이번 달", "최근 8주" 같은 화면에 기록이 들어 있다.
import { readFileSync } from 'node:fs'

const FIXTURE = new URL('../fixtures/sample-backup.json', import.meta.url)
const DAY = 24 * 60 * 60 * 1000
/** 점검용 브라우저의 시간대(Asia/Seoul)와 UTC의 차이. 앱은 날짜를 폰의 시간대로 센다. */
const KST = 9 * 60 * 60 * 1000

/** 한국 시간으로 그 시각이 속한 날의 번호(1970-01-01이 0) */
const dayNumber = (ts) => Math.floor((ts + KST) / DAY)
const dateKey = (ts) => new Date(ts + KST).toISOString().slice(0, 10)

/** 날짜를 옮긴 샘플 백업 내용 */
export function sampleBackup(now = Date.now()) {
  const backup = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const lastStart = Math.max(...backup.data.workouts.map((w) => w.startedAt))
  const shift = (dayNumber(now) - 1 - dayNumber(lastStart)) * DAY

  backup.exportedAt = new Date(Date.parse(backup.exportedAt) + shift).toISOString()
  for (const workout of backup.data.workouts) {
    workout.startedAt += shift
    if (workout.endedAt !== null) workout.endedAt += shift
    workout.date = dateKey(workout.startedAt)
  }
  return backup
}

/** 설정 화면의 "백업 파일 선택"에 그대로 넣을 수 있는 파일 */
export function sampleBackupFile(now = Date.now()) {
  return {
    name: 'sample-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sampleBackup(now))),
  }
}
