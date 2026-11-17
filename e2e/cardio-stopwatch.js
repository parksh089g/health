// 유산소 기록과 스톱워치: 스텝밀을 시간, 층수, 강도로 적고, 줄넘기는 시간만 적는다.
// 플랭크와 줄넘기의 세트 시간을 스톱워치로 재서(새로 고침과 다른 화면을 다녀와도 이어지는지, 취소와 세트 삭제까지)
// 운동을 마친 뒤 기록, 통계, 종목 상세, 다음 운동, 내 유산소 종목, 루틴, CSV까지 눌러 본다.
import { touchTargets } from './lib/layout.js'
import { patchRows, putRows, readRow } from './lib/store.js'

export const title = '유산소 기록과 스톱워치 (스텝밀 시간·층수·강도, 스톱워치로 세트 시간 재기, 통계와 종목 상세)'

/** 스톱워치를 적어 두는 자리(src/stopwatch/store.ts) */
const STOPWATCH_KEY = 'health.stopwatch'

/** 테이블의 모든 줄. 키를 모르는 줄(세트, 루틴)을 찾을 때 쓴다. */
function allRows(page, store) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('health-log')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const all = idb.transaction(store).objectStore(store).getAll()
          all.onerror = () => reject(all.error)
          all.onsuccess = () => {
            idb.close()
            resolve(all.result)
          }
        }
      }),
    store,
  )
}

export async function run(phone) {
  const { page, baseUrl, step, check, visible, hidden, text, attr, count, eventually } = phone
  const { open, shot, noOverflow, fill, card, skipRest, download, restTimer } = phone
  const main = page.getByRole('main')
  const search = page.getByLabel('종목 이름으로 찾기')
  const field = (exerciseCard, n, name) => exerciseCard.getByLabel(`${n}세트 ${name}`, { exact: true })
  const done = (exerciseCard, n) => exerciseCard.getByRole('button', { name: `${n}세트 완료`, exact: true })
  const chip = (exerciseCard, n) => exerciseCard.getByRole('button', { name: new RegExp(`^${n}세트 설정`) })
  const sheet = (n) => page.getByRole('dialog', { name: `${n}세트 설정` })
  const startWatch = (exerciseCard, n) => exerciseCard.getByRole('button', { name: `${n}세트 시간 재기`, exact: true })
  const watch = (exerciseCard) => exerciseCard.getByRole('timer', { name: '스톱워치' })
  const stopButton = (exerciseCard) => watch(exerciseCard).getByRole('button', { name: '멈추고 기록' })
  /** 스톱워치에 보이는 시간(초). 아직 없으면 null */
  const watchSeconds = async (exerciseCard) => {
    const clock = /(\d+):(\d\d)/.exec(await watch(exerciseCard).textContent({ timeout: 500 }))
    return clock ? Number(clock[1]) * 60 + Number(clock[2]) : null
  }
  const savedWatch = () => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), STOPWATCH_KEY)
  /** 이 운동의 세트를 종목 id별로, 순서대로 */
  const setsOf = async (exerciseId) => {
    const workoutId = /workout\/([^/]+)/.exec(page.url())?.[1] ?? /history\/([^/]+)/.exec(page.url())?.[1]
    const we = (await allRows(page, 'workoutExercises')).find((w) => w.workoutId === workoutId && w.exerciseId === exerciseId)
    return (await allRows(page, 'sets')).filter((s) => s.workoutExerciseId === we?.id).sort((a, b) => a.order - b.order)
  }
  const pick = async (name) => {
    await search.fill(name)
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
  }

  // ───────── 종목 고르기
  step('유산소 종목 고르기')
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 중 화면')
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  const parts = page.getByRole('group', { name: '부위' })
  const cardioChip = parts.getByRole('button', { name: '유산소' })
  await cardioChip.scrollIntoViewIfNeeded()
  await cardioChip.tap()
  await attr(cardioChip, 'aria-pressed', 'true', '부위에서 유산소를 고름')
  for (const name of ['러닝머신', '실내 자전거', '스텝밀', '일립티컬', '로잉 머신', '달리기', '줄넘기']) {
    await visible(page.getByRole('button', { name: new RegExp(`^${name}\\s*유산소 · (머신|기타)$`) }), `기본 종목 ${name}`)
  }
  await count(main.getByRole('listitem'), 7, '유산소 종목 7개')
  await noOverflow('종목 선택(부위 9개)')
  // 부위 버튼은 한 줄로 밀어서 본다. 맨 끝의 기타까지 밀면 보인다.
  await parts.getByRole('button', { name: '기타' }).scrollIntoViewIfNeeded()
  const lastChipVisible = await parts.getByRole('button', { name: '기타' }).evaluate((el) => {
    const box = el.getBoundingClientRect()
    return box.left >= 0 && box.right <= window.innerWidth
  })
  check(lastChipVisible, '부위 줄을 밀면 마지막 버튼(기타)까지 보임')
  await shot('01-picker-cardio')
  await page.getByRole('button', { name: /^스텝밀/ }).tap()
  await page.getByRole('button', { name: /^줄넘기/ }).tap()
  await parts.getByRole('button', { name: '전체' }).scrollIntoViewIfNeeded()
  await parts.getByRole('button', { name: '전체' }).tap()
  await pick('플랭크')
  await page.getByRole('button', { name: '선택한 3개 추가' }).tap()

  check((await readRow(page, 'exercises', 'seed:stepmill'))?.cardioMetric === 'floors', '스텝밀은 층수를 적는 유산소 종목으로 저장')

  // ───────── 스텝밀
  step('스텝밀: 시간, 층수, 강도')
  const stepmill = card('스텝밀')
  const rope = card('줄넘기')
  const plank = card('플랭크')
  await visible(stepmill, '스텝밀 카드')
  await visible(stepmill.getByText('유산소 · 머신'), '부위와 기구')
  await count(stepmill.getByLabel(/세트 시간$/), 1, '유산소는 한 세트로 시작')
  await count(stepmill.getByLabel(/세트 (무게|횟수)$/), 0, '무게와 횟수 칸이 없음')
  await visible(stepmill.getByText('층수', { exact: true }), '층수 칸 머리글')
  await count(plank.getByLabel(/세트 시간$/), 3, '시간 종목은 세 세트 그대로')

  // 시간 없이는 완료되지 않고 시간 칸으로 간다
  await fill(field(stepmill, 1, '층수'), '120')
  await done(stepmill, 1).tap()
  check((await done(stepmill, 1).getAttribute('aria-pressed')) === 'false', '층수만 적어서는 완료되지 않음')
  check(await field(stepmill, 1, '시간').evaluate((el) => document.activeElement === el), '시간 칸으로 포커스 이동')

  await fill(field(stepmill, 1, '시간'), '30')
  // 층수는 네 자리까지 받는다
  await fill(field(stepmill, 1, '층수'), '1250')
  await eventually(() => field(stepmill, 1, '층수').inputValue(), '1250', '층수는 999를 넘게 적을 수 있음')
  await fill(field(stepmill, 1, '층수'), '120')

  await chip(stepmill, 1).tap()
  await visible(sheet(1).getByText('30분 · 120층'), '세트 창 요약 30분 · 120층')
  await visible(sheet(1).getByText('기구에 표시되는 레벨이나 속도입니다. 적지 않아도 됩니다.'), '강도 안내')
  await visible(sheet(1).getByText('힘든 정도 (RPE)'), 'RPE도 그대로 있음')
  await fill(sheet(1).getByLabel('강도', { exact: true }), '8')
  await touchTargets(phone, '유산소 세트 창', sheet(1))
  await shot('02-set-sheet-level')
  await sheet(1).getByRole('button', { name: '닫기' }).tap()
  await text(chip(stepmill, 1), '강도 8', '세트 번호 아래에 강도 8')

  await done(stepmill, 1).tap()
  await attr(done(stepmill, 1), 'aria-pressed', 'true', '스텝밀 1세트 완료')
  await hidden(restTimer, '유산소는 휴식 타이머를 시작하지 않음', 1500)
  await eventually(
    async () => {
      const [s] = await setsOf('seed:stepmill')
      return [s.durationSec, s.floors, s.level, s.weightKg, s.reps, s.isDone]
    },
    [1800, 120, 8, null, null, true],
    '저장: 1800초, 120층, 강도 8, 무게와 횟수는 비움',
  )

  // ───────── 줄넘기: 시간만
  step('줄넘기: 시간만')
  await count(rope.getByLabel(/세트 (거리|층수)$/), 0, '시간만 적는 종목은 거리와 층수 칸이 없음')
  const timeBox = await field(rope, 1, '시간').evaluate((el) => el.closest('label').getBoundingClientRect().width)
  const stepBox = await field(stepmill, 1, '시간').evaluate((el) => el.closest('label').getBoundingClientRect().width)
  check(timeBox > stepBox * 1.8, `시간 칸이 두 칸 자리를 다 씀 (${Math.round(timeBox)}px, 스텝밀은 ${Math.round(stepBox)}px)`)
  await fill(field(rope, 1, '시간'), '12.5')
  await eventually(async () => (await setsOf('seed:jump-rope'))[0].durationSec, 750, '12.5분은 750초로 저장')
  await chip(rope, 1).tap()
  await visible(sheet(1).getByText('12분 30초'), '세트 창 요약 12분 30초')
  await sheet(1).getByRole('button', { name: '닫기' }).tap()

  // ───────── 스톱워치: 플랭크
  step('스톱워치로 플랭크 시간 재기')
  // 목표 시간 2초: 채우면 알리고 계속 센다.
  await patchRows(page, 'exercises', ['seed:plank'], { targetReps: 2 })
  await page.reload()
  await visible(plank.getByText('목표 2초'), '플랭크 목표 2초')
  await visible(startWatch(plank, 1), '플랭크 카드에 시간 재기 버튼')
  await visible(startWatch(rope, 1), '줄넘기 카드에도 시간 재기 버튼')
  await count(stepmill.getByRole('button', { name: /시간 재기$/ }), 0, '세트를 다 끝낸 종목에는 버튼이 없음')
  await touchTargets(phone, '운동 카드(유산소)', stepmill)
  await noOverflow('운동 중(유산소)')
  await shot('03-workout-cardio', { fullPage: true })

  await startWatch(plank, 1).tap()
  await visible(watch(plank), '스톱워치가 돌기 시작')
  await visible(watch(plank).getByText('1세트 재는 중'), '어느 세트를 재는지 보임')
  check(await rope.getByRole('button', { name: '다른 종목의 시간을 재는 중' }).isDisabled(), '한 번에 하나만: 다른 종목은 시작할 수 없음')
  check((await savedWatch())?.targetSec === 2, '시작한 시각과 목표 시간을 저장')
  await visible(watch(plank).getByText('목표 2초 채움'), '목표 시간을 채우면 표시', 6000)
  await touchTargets(phone, '스톱워치', watch(plank))
  await noOverflow('스톱워치')
  await shot('04-stopwatch-running', { of: plank })
  await eventually(async () => (await savedWatch())?.alerted, true, '목표 알림은 한 번만(알렸다고 저장)')

  // 새로 고쳐도, 다른 화면에 다녀와도 이어진다
  const beforeReload = await watchSeconds(plank)
  await page.reload()
  await visible(watch(plank), '새로 고쳐도 스톱워치가 그대로')
  const afterReload = await watchSeconds(plank)
  check(afterReload !== null && afterReload >= beforeReload, `새로 고친 뒤에도 이어서 셈 (${beforeReload}초 → ${afterReload}초)`)
  await plank.getByRole('link', { name: /플랭크/ }).tap()
  await visible(page.getByRole('heading', { name: '플랭크', exact: true }), '종목 상세로 나감')
  await page.goBack()
  await visible(watch(plank), '돌아와도 스톱워치가 그대로')
  const afterBack = await watchSeconds(plank)
  check(afterBack >= afterReload, `다른 화면에 다녀와도 이어서 셈 (${afterBack}초)`)

  await stopButton(plank).tap()
  await hidden(watch(plank), '멈추면 스톱워치가 사라짐')
  await attr(done(plank, 1), 'aria-pressed', 'true', '잰 세트가 완료로 표시')
  const held = Number(await field(plank, 1, '시간').inputValue())
  check(held >= afterBack && held <= afterBack + 3, `잰 시간이 세트에 적힘 (${held}초)`)
  await eventually(async () => [(await setsOf('seed:plank'))[0].durationSec, (await setsOf('seed:plank'))[0].isDone], [held, true], '저장된 세트도 같은 시간, 완료')
  await visible(restTimer, '시간 종목은 완료 체크와 같이 휴식 타이머가 시작')
  await skipRest()
  check((await savedWatch()) === null, '멈춘 뒤에는 저장된 스톱워치가 없음')

  // 취소: 기록하지 않는다
  step('스톱워치 취소와 세트 삭제')
  await startWatch(plank, 2).tap()
  await visible(watch(plank).getByText('2세트 재는 중'), '다음 세트(2세트)를 잼')
  await watch(plank).getByRole('button', { name: '시간 재기 취소' }).tap()
  await hidden(watch(plank), '취소하면 사라짐')
  check((await done(plank, 2).getAttribute('aria-pressed')) === 'false', '취소한 세트는 완료되지 않음')
  check((await field(plank, 2, '시간').inputValue()) === '', '취소한 세트에는 시간이 적히지 않음')
  await hidden(restTimer, '취소는 휴식 타이머를 시작하지 않음', 1000)

  // 재던 세트를 지우면 스톱워치도 사라진다
  await startWatch(plank, 2).tap()
  await visible(watch(plank), '2세트를 다시 잼')
  await chip(plank, 2).tap()
  await sheet(2).getByRole('button', { name: '세트 삭제' }).tap()
  await count(plank.getByLabel(/세트 시간$/), 2, '2세트를 지움')
  await hidden(watch(plank), '재던 세트를 지우면 스톱워치도 사라짐')
  await eventually(savedWatch, null, '저장된 스톱워치도 지워짐')
  await visible(startWatch(plank, 2), '남은 세트로 다시 잴 수 있음')

  // ───────── 스톱워치: 유산소
  step('스톱워치로 줄넘기 시간 재기')
  await startWatch(rope, 1).tap()
  await visible(watch(rope), '줄넘기 스톱워치')
  await count(watch(rope).getByText(/목표/), 0, '유산소에는 목표 시간이 없음')
  await eventually(async () => ((await watchSeconds(rope)) ?? 0) >= 1, true, '1초 넘게 잼')
  await stopButton(rope).tap()
  await attr(done(rope, 1), 'aria-pressed', 'true', '줄넘기 세트가 완료로 표시')
  await hidden(restTimer, '유산소는 스톱워치로 끝내도 휴식 타이머가 없음', 1500)
  const ropeSeconds = (await setsOf('seed:jump-rope'))[0].durationSec
  check(Number.isInteger(ropeSeconds) && ropeSeconds >= 1 && ropeSeconds <= 6, `유산소도 초로 저장 (${ropeSeconds}초)`)
  const shownMinutes = Number(await field(rope, 1, '시간').inputValue())
  check(Math.round(shownMinutes * 60) === ropeSeconds, `분 칸이 잰 시간을 보여 줌 (${shownMinutes}분)`)
  // 고쳐 적으면 그 값으로 바뀐다(완료는 그대로)
  await fill(field(rope, 1, '시간'), '12.5')
  await eventually(async () => [(await setsOf('seed:jump-rope'))[0].durationSec, (await setsOf('seed:jump-rope'))[0].isDone], [750, true], '고쳐 적은 12.5분으로 저장')

  // 폭이 320px인 작은 폰
  const size = page.viewportSize()
  await page.setViewportSize({ width: 320, height: size.height })
  await startWatch(plank, 2).tap()
  await visible(watch(plank), '좁은 화면의 스톱워치')
  await noOverflow('운동 중(폭 320px)')
  const clipped = await stepmill.evaluate((el) =>
    [...el.querySelectorAll('input')].filter((input) => input.scrollWidth > input.clientWidth + 1).map((input) => input.getAttribute('aria-label')),
  )
  check(clipped.length === 0, `폭 320px에서 값이 잘리지 않음${clipped.length ? ` (${clipped.join(', ')})` : ''}`)
  await touchTargets(phone, '스톱워치(폭 320px)', watch(plank))
  await shot('05-workout-narrow', { fullPage: true })
  await watch(plank).getByRole('button', { name: '시간 재기 취소' }).tap()
  await page.setViewportSize(size)

  // ───────── AI 추천을 받을 종목이 없다
  step('유산소와 시간 종목뿐이면 AI 추천을 받지 않음')
  // 키는 가짜다. 버튼이 꺼져 있어서 어디에도 보내지 않는다.
  await putRows(page, {
    settings: [
      { key: 'aiEnabled', value: true },
      { key: 'aiApiKey', value: 'sk-ant-e2e-not-a-real-key' },
    ],
  })
  await page.reload()
  await visible(page.getByRole('region', { name: 'AI 코치' }), 'AI 코치 칸')
  const aiButton = page.getByRole('button', { name: '종목을 추가하면 받을 수 있어요' })
  await visible(aiButton, 'AI 추천 버튼이 받을 수 없는 상태')
  check(await aiButton.isDisabled(), 'AI 추천 버튼이 꺼져 있음')
  await count(page.getByRole('button', { name: 'AI 추천 받기' }), 0, 'AI 추천 받기를 내놓지 않음')
  await putRows(page, {
    settings: [
      { key: 'aiEnabled', value: false },
      { key: 'aiApiKey', value: '' },
    ],
  })
  await page.reload()

  // ───────── 마치기
  step('운동 마치기')
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  const stat = (label) => main.locator('dl > div').filter({ hasText: label }).locator('dd')
  await text(stat('유산소'), '42분 30초', '유산소 42분 30초(30분 + 12분 30초)')
  await text(stat('완료한 세트'), '3개', '완료한 세트 3개')
  await text(stat('총 볼륨'), '0kg', '유산소는 볼륨에 들어가지 않음')
  await noOverflow('운동 완료')
  await shot('06-done')
  await page.getByRole('button', { name: '저장', exact: true }).tap()

  // ───────── 기록
  step('기록 상세와 목록')
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '기록 상세')
  await visible(page.getByText('종목 3개 · 3세트 · 볼륨 0kg'), '요약: 종목 3개 · 3세트 · 볼륨 0kg')
  await eventually(
    async () => [await field(stepmill, 1, '시간').inputValue(), await field(stepmill, 1, '층수').inputValue()],
    ['30', '120'],
    '스텝밀: 30분, 120층',
  )
  await text(chip(stepmill, 1), '강도 8', '기록 상세에도 강도 8')
  await eventually(() => field(rope, 1, '시간').inputValue(), '12.5', '줄넘기: 12.5분')
  await count(page.getByRole('button', { name: /시간 재기$/ }), 0, '지난 기록에는 스톱워치가 없음')
  await noOverflow('기록 상세')
  await shot('07-history-detail', { fullPage: true })
  await open('/history')
  await visible(page.getByText('스텝밀, 줄넘기, 플랭크'), '기록 목록에 종목 이름')
  await visible(page.getByText(/· 3세트$/), '기록 목록에 3세트(볼륨이 0이면 kg는 보이지 않음)')

  // ───────── 통계
  step('통계의 유산소')
  await open('/stats')
  const cardio = page.getByRole('region', { name: '유산소', exact: true })
  await visible(cardio, '유산소 칸')
  await text(cardio, '42분 30초', '이번 주 유산소 42분 30초')
  await text(cardio, /이번 주 · \d+월 \d+일/, '이번 주가 골라져 있음')
  await visible(cardio.getByRole('img', { name: '주별 유산소 시간 그래프' }).or(cardio.getByLabel('주별 유산소 시간 그래프')).first(), '주별 유산소 시간 그래프')
  await cardio.scrollIntoViewIfNeeded()
  await noOverflow('통계')
  await shot('08-stats-cardio', { fullPage: true })
  const stepmillRow = page.getByRole('link', { name: /^스텝밀/ })
  await text(stepmillRow, /최장 시간\s*30분/, '종목 목록: 스텝밀 최장 시간 30분')

  // ───────── 종목 상세
  step('스텝밀 종목 상세')
  await stepmillRow.tap()
  await visible(page.getByRole('heading', { name: '스텝밀', exact: true }), '스텝밀 상세')
  await visible(page.getByRole('link', { name: /^최장 시간 30분/ }), '개인 기록 최장 시간 30분')
  await visible(page.getByRole('link', { name: /^최다 층수 120층/ }), '개인 기록 최다 층수 120층')
  await count(page.getByRole('link', { name: /^(추정 1RM|최고 중량|최고 볼륨)/ }), 0, '유산소에는 무게 기록이 없음')
  const metrics = page.getByRole('group', { name: '그래프로 볼 값' })
  await visible(metrics.getByRole('button', { name: '시간' }), '그래프: 시간')
  await metrics.getByRole('button', { name: '층수' }).tap()
  await visible(page.getByText('120층', { exact: true }).first(), '그래프: 층수 120층')
  await visible(page.getByText('30분 120층'), '지난 기록에 30분 120층')
  await count(page.getByRole('heading', { name: '목표', exact: true }), 0, '목표 설정이 없음')
  await count(page.getByRole('heading', { name: '휴식 시간', exact: true }), 0, '휴식 시간 설정이 없음')
  await visible(page.getByLabel('종목 메모'), '메모는 그대로 있음')
  await noOverflow('스텝밀 상세')
  await shot('09-stepmill-detail', { fullPage: true })

  // ───────── 다음 운동
  step('다음 운동: 지난 값 채우기, 추천 없음')
  await open('/history')
  await page.getByRole('link', { name: /스텝밀, 줄넘기, 플랭크/ }).tap()
  await page.getByRole('button', { name: '같은 운동 다시 하기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '새 운동 화면')
  await eventually(
    async () => [await field(stepmill, 1, '시간').inputValue(), await field(stepmill, 1, '층수').inputValue()],
    ['30', '120'],
    '스텝밀: 지난번 시간과 층수로 채움',
  )
  await text(chip(stepmill, 1), '강도 8', '지난번 강도도 따라옴')
  await visible(stepmill.getByText('지난번 30분 120층'), '스텝밀 지난번 줄')
  await visible(rope.getByText('지난번 12분 30초'), '줄넘기 지난번 줄')
  await count(stepmill.getByRole('group', { name: '다음 무게 추천' }), 0, '유산소에는 추천이 없음')
  await count(rope.getByRole('group', { name: '다음 무게 추천' }), 0, '줄넘기에도 추천이 없음')
  await visible(plank.getByRole('group', { name: '다음 무게 추천' }), '플랭크 추천은 그대로 나옴')
  await shot('10-next-workout', { fullPage: true })

  // 스톱워치가 도는 채로 마치러 가면, 잰 시간을 버리지 않고 기록할 수 있다
  step('스톱워치가 도는 채로 운동 마치기')
  await startWatch(rope, 1).tap()
  await visible(watch(rope), '줄넘기 스톱워치')
  await page.getByRole('button', { name: '마치기' }).tap()
  const running = page.getByRole('region', { name: '재는 중인 스톱워치' })
  await visible(running, '운동 완료 화면에 재는 중인 스톱워치 안내')
  await visible(running.getByText(/줄넘기 시간을 아직 재고 있습니다/), '어느 종목인지 보임')
  await noOverflow('운동 완료(스톱워치가 도는 중)')
  await shot('10b-done-with-stopwatch')
  await running.getByRole('button', { name: '멈추고 기록' }).tap()
  await hidden(running, '멈추면 안내가 사라짐')
  await eventually(savedWatch, null, '스톱워치를 멈춤')
  await eventually(
    async () => {
      const [first] = await setsOf('seed:jump-rope')
      return first.isDone && first.durationSec >= 1 && first.durationSec < 60
    },
    true,
    '지난번 값(12.5분) 대신 잰 시간을 완료로 기록',
  )
  await page.getByRole('button', { name: '운동으로 돌아가기' }).last().tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동으로 돌아옴')

  // 스톱워치가 도는 채로 운동을 취소하면 스톱워치도 사라진다
  await startWatch(stepmill, 1).tap()
  await visible(watch(stepmill), '스텝밀 스톱워치')
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(page.getByRole('button', { name: '운동 시작' }), '운동을 취소하고 홈으로')
  await eventually(savedWatch, null, '운동을 취소하면 스톱워치도 지워짐')

  // ───────── 내 유산소 종목
  step('내 유산소 종목 만들기')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await search.fill('계단 오르기')
  await page.getByRole('button', { name: '내 종목 추가' }).tap()
  const measure = page.getByRole('group', { name: '기록 방식' })
  await attr(measure.getByRole('button', { name: '횟수' }), 'aria-pressed', 'true', '기본은 횟수')
  await count(page.getByRole('group', { name: '시간과 함께 적을 값' }), 0, '유산소를 고르기 전에는 함께 적을 값이 없음')
  await measure.getByRole('button', { name: '유산소' }).tap()
  await eventually(() => page.getByRole('combobox', { name: '부위' }).inputValue(), 'cardio', '유산소를 고르면 부위도 유산소로')
  const metric = page.getByRole('group', { name: '시간과 함께 적을 값' })
  await attr(metric.getByRole('button', { name: '거리(km)' }), 'aria-pressed', 'true', '기본은 거리')
  await metric.getByRole('button', { name: '층수' }).tap()
  await attr(metric.getByRole('button', { name: '층수' }), 'aria-pressed', 'true', '층수를 고름')
  await visible(metric.getByRole('button', { name: '시간만' }), '시간만도 고를 수 있음')
  await metric.scrollIntoViewIfNeeded()
  await touchTargets(phone, '내 종목 추가(유산소)', page.locator('form'))
  await noOverflow('내 종목 추가(유산소)')
  await shot('11-custom-cardio-form')
  await page.getByRole('button', { name: '추가', exact: true }).tap()
  await visible(page.getByRole('button', { name: /^계단 오르기\s*유산소 · 머신 · 내 종목/ }), '내 종목이 유산소로 만들어짐')
  await page.getByRole('button', { name: '선택한 1개 추가' }).tap()
  const stairs = card('계단 오르기')
  await visible(field(stairs, 1, '층수'), '계단 오르기 카드에 층수 칸')
  const custom = (await allRows(page, 'exercises')).find((e) => e.name === '계단 오르기')
  check(
    custom?.measure === 'cardio' && custom?.cardioMetric === 'floors' && custom?.bodyPart === 'cardio' && custom?.isCustom === true,
    '저장: 유산소, 층수, 부위 유산소, 내 종목',
  )

  // 운동에 넣은 종목은 기록 방식을 바꿀 수 없다
  await stairs.getByRole('link', { name: /계단 오르기/ }).tap()
  await page.getByRole('button', { name: '이름·부위·기구 바꾸기' }).tap()
  await visible(page.getByText('기록이 있는 종목은 기록 방식과 함께 적는 값을 바꿀 수 없습니다.'), '기록이 있으면 바꿀 수 없다는 안내')
  check(await page.getByRole('group', { name: '기록 방식' }).getByRole('button', { name: '횟수' }).isDisabled(), '횟수 버튼이 잠김')
  await page.getByRole('button', { name: '취소', exact: true }).tap()
  await page.goBack()
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(page.getByRole('button', { name: '운동 시작' }), '홈으로 돌아옴')

  // ───────── 루틴
  step('루틴의 유산소 종목')
  await open('/routines/new')
  await page.getByLabel('루틴 이름').fill('하체와 유산소')
  await page.getByRole('button', { name: '종목 추가' }).tap()
  await pick('스쿼트')
  await pick('스텝밀')
  await page.getByRole('button', { name: '선택한 2개 추가' }).tap()
  const squatRow = page.getByRole('listitem', { name: '스쿼트', exact: true })
  const stepmillItem = page.getByRole('listitem', { name: '스텝밀', exact: true })
  await visible(squatRow.getByLabel('스쿼트 목표 횟수'), '스쿼트에는 목표 횟수 칸')
  await count(stepmillItem.getByLabel(/목표/), 0, '유산소에는 목표 칸이 없음')
  await text(stepmillItem.getByRole('group', { name: '스텝밀 세트 수' }), '1', '유산소는 한 세트로 들어감')
  await noOverflow('루틴 편집')
  await shot('12-routine-cardio')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await page.waitForURL((url) => !url.hash.includes('/routines/new'))
  await eventually(
    async () => (await allRows(page, 'routines')).find((r) => r.name === '하체와 유산소')?.items.map((it) => [it.exerciseId, it.sets, it.reps]),
    [
      ['seed:squat', 3, null],
      ['seed:stepmill', 1, null],
    ],
    '저장된 루틴: 스텝밀은 1세트, 목표 없음',
  )
  await open('/')
  await page.getByRole('button', { name: '하체와 유산소 루틴 시작' }).tap()
  await eventually(
    async () => [await field(stepmill, 1, '시간').inputValue(), await field(stepmill, 1, '층수').inputValue()],
    ['30', '120'],
    '루틴으로 시작해도 지난 값으로 채움',
  )
  await count(stepmill.getByText(/목표/), 0, '운동 카드에 목표가 없음')
  await page.getByRole('button', { name: '운동 취소' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '취소하고 지우기' }).tap()
  await visible(page.getByRole('button', { name: '운동 시작' }), '운동을 취소하고 홈으로')

  // ───────── CSV
  step('CSV')
  await open('/settings')
  const csvButton = page.getByRole('button', { name: '기록 CSV 내보내기' })
  await csvButton.scrollIntoViewIfNeeded()
  const csv = await download(csvButton)
  check(csv.text.includes('시간(초),RPE,운동 메모,거리(km),층,강도'), 'CSV에 거리(km), 층, 강도 칸')
  check(csv.text.includes('스텝밀,유산소,머신,1,,,,1800,,,,120,8'), 'CSV에 스텝밀 1800초, 120층, 강도 8 줄')
  check(csv.text.includes('줄넘기,유산소,기타,1,,,,750,,,,,'), 'CSV에 줄넘기 750초 줄')

  step('콘솔')
  phone.consoleClean()
}
