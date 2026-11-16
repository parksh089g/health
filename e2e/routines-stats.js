// 루틴과 통계: 약 10주 기록이 있는 폰에서 루틴을 만들어 시작하고, 다음 무게 추천을 적용하고,
// 새 기록(PR) 표시, 통계, 종목 상세, CSV와 백업 내보내기까지 이어서 눌러 본다.
import { BACKUP_VERSION } from './lib/phone.js'

export const title = '루틴과 통계 (루틴, 다음 무게 추천, 개인 기록, 통계, 종목 상세, 내보내기)'

export async function run(phone) {
  const { page, step, check, visible, eventually } = phone
  const { open, shot, noOverflow, card, setValues, skipRest, download, restoreSample } = phone
  /** 종목 카드 안의 규칙 추천 줄 */
  const recommendation = (name) => card(name).getByRole('group', { name: '다음 무게 추천' })

  // ───────── 백업에서 복원 (약 10주 기록)
  step('샘플 기록 복원')
  await restoreSample()

  // ───────── 루틴 만들기
  step('루틴 만들기')
  await open('/routines/new')
  await page.getByLabel('루틴 이름').fill('상체 A')
  await page.getByRole('button', { name: '종목 추가' }).tap()
  for (const name of ['벤치프레스', '랫풀다운']) {
    await page.getByLabel('종목 이름으로 찾기').fill(name)
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
  }
  await page.getByRole('button', { name: '선택한 2개 추가' }).tap()
  const benchRow = page.getByRole('listitem', { name: '벤치프레스', exact: true })
  const latRow = page.getByRole('listitem', { name: '랫풀다운', exact: true })
  await benchRow.getByRole('button', { name: '세트 늘리기' }).tap()
  await benchRow.getByLabel('벤치프레스 목표 횟수').fill('8')
  await latRow.getByLabel('랫풀다운 목표 횟수').fill('10')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await page.waitForURL((url) => !url.hash.includes('/routines/new'))

  step('홈')
  await open('/')
  const routines = page.getByRole('region', { name: '루틴', exact: true })
  await visible(routines.getByText('상체 A'), '새로 만든 루틴이 홈에 보임')
  await noOverflow('홈')
  await shot('01-home')

  // ───────── 루틴으로 시작 → 추천 → 적용
  step('루틴으로 시작, 추천')
  await page.getByRole('button', { name: '상체 A 루틴 시작' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 화면')
  const bench = card('벤치프레스')
  const benchSets = () => setValues(bench, ['W', 1, 2, 3, 4])
  await eventually(benchSets, '40x8 75x8 75x8 75x8 70x10', '벤치: 지난 기록(웜업 + 75×8×3 + 백오프 70×10)으로 채움')
  await visible(recommendation('벤치프레스').getByText('추천 77.5kg × 8'), '벤치 추천 77.5kg × 8')
  const lat = card('랫풀다운')
  await visible(lat, '랫풀다운 카드')
  await eventually(() => setValues(lat, [1]), '62.5x10', '랫풀다운: 지난 기록으로 채움')
  await noOverflow('운동 중')
  await shot('02-workout-recommend')

  await recommendation('벤치프레스').getByRole('button', { name: /적용$/ }).tap()
  await eventually(benchSets, '40x8 77.5x8 77.5x8 77.5x8 70x10', '적용: 75kg 세트만 77.5kg로, 백오프 70×10과 웜업은 그대로')
  await visible(recommendation('벤치프레스').getByRole('button', { name: '추천 적용됨' }), '적용됨 표시')

  // ───────── 세트 완료 → 실시간 PR
  step('실시간 PR')
  await bench.getByRole('button', { name: 'W세트 완료' }).tap()
  await skipRest()
  await bench.getByRole('button', { name: '1세트 완료', exact: true }).tap()
  await skipRest()
  await visible(bench.getByRole('img', { name: /^새 기록/ }), '77.5×8 완료하면 새 기록 표시')
  for (const n of [2, 3, 4]) {
    await bench.getByRole('button', { name: `${n}세트 완료`, exact: true }).tap()
    await skipRest()
  }
  await shot('03-workout-pr')
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  await visible(page.getByRole('region', { name: '새 기록' }), '완료 화면에 새 기록')
  await shot('04-done', { fullPage: true })
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '기록 상세')
  await visible(page.getByText(/새 기록 \d+개/), '기록 상세에 새 기록 N개')

  // ───────── 통계
  step('통계')
  await open('/stats')
  await visible(page.getByRole('heading', { name: '통계', exact: true }), '통계 화면')
  const month = await page.evaluate(() => new Date().getMonth() + 1)
  await visible(page.getByRole('heading', { name: `${month}월 운동` }), '이번 달 운동 타일')
  await noOverflow('통계')
  await shot('05-stats', { fullPage: true })
  await page.getByRole('link', { name: /^벤치프레스/ }).first().tap()

  step('종목 상세')
  await visible(page.getByRole('heading', { name: '벤치프레스', exact: true }), '벤치프레스 상세')
  const bestWeight = /^최고 중량 77\.5kg/
  await visible(
    page.getByRole('button', { name: bestWeight }).or(page.getByRole('link', { name: bestWeight })),
    '개인 기록 최고 중량 77.5kg',
  )
  await noOverflow('종목 상세')
  await shot('06-exercise-detail', { fullPage: true })
  const goal = page.getByLabel('목표 횟수', { exact: true })
  await goal.fill('10')
  await goal.blur()
  // 저장됐는지는 화면이 아니라 저장소(IndexedDB)에서 직접 읽어 본다.
  const savedTargetReps = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const open = indexedDB.open('health-log')
          open.onsuccess = () => {
            const get = open.result.transaction('exercises').objectStore('exercises').get('seed:bench-press')
            get.onsuccess = () => {
              resolve(get.result?.targetReps ?? null)
              open.result.close()
            }
          }
        }),
    )
  await eventually(savedTargetReps, 10, '목표 횟수 10 저장')

  // ───────── 설정: CSV, 백업
  step('내보내기')
  await open('/settings')
  const csvButton = page.getByRole('button', { name: '기록 CSV 내보내기' })
  await csvButton.scrollIntoViewIfNeeded()
  const csv = await download(csvButton)
  check(/^health-records-\d{4}-\d{2}-\d{2}\.csv$/.test(csv.name), `CSV 파일 이름 ${csv.name}`)
  check(csv.text.startsWith('﻿날짜,시작,종목'), 'CSV 머리줄과 BOM')
  check(csv.text.includes('벤치프레스,가슴,바벨,1,,77.5,8'), 'CSV에 오늘 77.5×8 줄')
  check(csv.text.split('\r\n').length > 400, `CSV 줄 수 ${csv.text.split('\r\n').length}`)
  await visible(page.getByText(/파일을 받았습니다/), 'CSV 안내')
  await page.getByRole('region', { name: '표로 내보내기' }).scrollIntoViewIfNeeded()
  await noOverflow('설정')
  await shot('07-settings-csv')

  const backup = JSON.parse((await download(page.getByRole('button', { name: '백업 파일 저장' }))).text)
  check(backup.version === BACKUP_VERSION, `백업 버전 ${BACKUP_VERSION} (실제: ${backup.version})`)
  check(backup.data.routines.length === 1 && backup.data.routines[0].name === '상체 A', '백업에 루틴 포함')
  check(backup.data.exercises.find((e) => e.id === 'seed:bench-press')?.targetReps === 10, '백업에 목표 횟수 포함')

  step('콘솔')
  phone.consoleClean()
}
