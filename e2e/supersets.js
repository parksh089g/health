// 슈퍼세트: 운동 중에 종목을 묶고(둘, 셋), 묶인 카드가 한 덩어리로 보이는지,
// 세트를 완료했을 때 한 바퀴가 끝나야만 휴식 타이머가 시작되는지, 옮기고 풀었을 때 묶음이 맞는지 본다.
// 이어서 루틴에서 묶어 저장하고 그 루틴으로 운동해, 운동 화면과 기록 상세, 루틴으로 저장, 다시 하기까지 묶음이 따라가는지 본다.
import { boxOf, touchTargets } from './lib/layout.js'

export const title = '슈퍼세트 (묶기와 풀기, 휴식 타이머 규칙, 옮기기, 루틴, 기록 상세)'

const BENCH = '벤치프레스'
const LAT = '랫풀다운'
const SQUAT = '스쿼트'
const HINT = '마지막 종목 뒤에 쉽니다'

/** 테이블의 모든 줄 */
function allRows(page, store) {
  return page.evaluate(
    (store) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('health-log')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const idb = open.result
          const get = idb.transaction(store).objectStore(store).getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            idb.close()
            resolve(get.result)
          }
        }
      }),
    store,
 )
}

/** 종목들을 순서대로, 같은 묶음끼리 [ ]로 묶어 적는다. 예: '[벤치프레스 랫풀다운] 스쿼트' */
function layoutOf(entries) {
  const grouped = (i) => entries[i]?.supersetId != null && entries[i].supersetId === entries[i + 1]?.supersetId
  return entries
    .map((entry, i) => `${grouped(i) && !grouped(i - 1) ? '[' : ''}${entry.name}${grouped(i - 1) && !grouped(i) ? ']' : ''}`)
    .join(' ')
}

export async function run(phone) {
  const { page, step, check, visible, hidden, text, count, attr, eventually } = phone
  const { open, hash, shot, noOverflow, fill, card, restTimer: timer, skipRest } = phone
  const main = page.getByRole('main')
  const search = page.getByLabel('종목 이름으로 찾기')
  const trays = main.locator('[data-superset]')
  const tray = (position) => main.locator(`[data-superset=${position}]`)
  const linkButton = (a, b) => page.getByRole('button', { name: `${a}, ${b} 슈퍼세트로 묶기`, exact: true })
  const unlinkButton = (a, b) => page.getByRole('button', { name: `${a}, ${b} 슈퍼세트 묶음 풀기`, exact: true })
  const doneButton = (name, n) => card(name).getByRole('button', { name: `${n}세트 완료`, exact: true })

  /** 주소에 있는 운동(또는 기록)의 종목 묶음을 저장소에서 읽는다. */
  const workoutId = () => /^#\/(?:workout|history)\/([0-9a-f-]{36})/.exec(hash())?.[1]
  const workoutRows = async (id = workoutId()) => {
    const exercises = new Map((await allRows(page, 'exercises')).map((e) => [e.id, e.name]))
    return (await allRows(page, 'workoutExercises'))
      .filter((we) => we.workoutId === id)
      .sort((a, b) => a.order - b.order)
      .map((we) => ({ name: exercises.get(we.exerciseId), supersetId: we.supersetId ?? null }))
  }
  const storedLayout = async (id) => layoutOf(await workoutRows(id))
  const routineRows = async (name) => {
    const exercises = new Map((await allRows(page, 'exercises')).map((e) => [e.id, e.name]))
    const routine = (await allRows(page, 'routines')).find((r) => r.name === name)
    return (routine?.items ?? []).map((item) => ({ ...item, name: exercises.get(item.exerciseId) }))
  }

  /** 카드가 화면 안에 다 들어와 있는지(윗줄 아래부터 화면 끝까지). 긴 카드는 윗부분이 보이면 된다. */
  const inView = async (name) => {
    const box = await boxOf(card(name))
    const height = page.viewportSize().height
    const headerBottom = (await boxOf(page.getByRole('banner'))).bottom
    return box.top >= headerBottom && (box.bottom <= height || box.height > height - headerBottom)
  }
  /** 종목 선택 화면에서 종목들을 순서대로 고른다. */
  const pick = async (names) => {
    for (const name of names) {
      await search.fill(name)
      await page.getByRole('button', { name: new RegExp(`^${name}`) }).first().tap()
    }
    await page.getByRole('button', { name: `선택한 ${names.length}개 추가` }).tap()
  }
  /** 세트 값을 넣고 완료로 표시한다. 휴식 타이머는 그대로 둔다. */
  const doSet = async (name, n, weightKg, reps) => {
    await fill(card(name).getByLabel(`${n}세트 무게`, { exact: true }), weightKg)
    await fill(card(name).getByLabel(`${n}세트 횟수`, { exact: true }), reps)
    await doneButton(name, n).tap()
    await attr(doneButton(name, n), 'aria-pressed', 'true', `${name} ${n}세트 완료`)
  }
  /** 쉬지 않고 넘어갔는지: 타이머가 뜰 틈을 준 뒤에도 없어야 한다. */
  const noRest = async (message) => {
    await page.waitForTimeout(400)
    check(!(await timer.isVisible()), message)
  }
  /** 묶음이 한 덩어리로 보이는지: 묶인 카드들이 끊김 없이 이어진 같은 색 바탕 안에 들어 있다. */
  const oneUnit = async (label, names) => {
    const parts = await trays.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, color: getComputedStyle(el).backgroundColor }
      }),
   )
    const joined = parts.every((part, i) => i === 0 || Math.abs(part.top - parts[i - 1].bottom) < 0.5)
    const sameColor = new Set(parts.map((part) => part.color)).size === 1 && !/rgba\(0, 0, 0, 0\)|transparent/.test(parts[0].color)
    check(parts.length === names.length && joined && sameColor, `${label}: 바탕이 끊기지 않고 이어짐 (${parts.length}칸, ${parts[0]?.color})`)
    for (const [i, name] of names.entries()) {
      const box = await boxOf(card(name))
      const part = parts[i]
      const inside = box.left >= part.left && box.right <= part.right && box.top >= part.top && box.bottom <= part.bottom
      check(inside, `${label}: ${name} 카드가 묶음 바탕 안에 있음`)
    }
    const screen = page.viewportSize().width
    check(
      parts.every((part) => part.left >= 0 && part.right <= screen),
      `${label}: 묶음 바탕이 화면 밖으로 나가지 않음`,
   )
  }
  /** 폭 320px인 작은 폰에서도 넘치거나 잘리지 않는지 본다. */
  const narrow = async (label, shotName, root = main) => {
    const size = page.viewportSize()
    await page.setViewportSize({ width: 320, height: size.height })
    await noOverflow(`${label}(폭 320px)`)
    const hint = main.getByText(HINT).first()
    check(await hint.evaluate((el) => el.scrollWidth <= el.clientWidth), `${label}(폭 320px): 묶음 안내 글이 잘리지 않음`)
    await touchTargets(phone, `${label}(폭 320px)`, root)
    await shot(shotName)
    await page.setViewportSize(size)
  }

  // ───────── 운동 시작, 종목 셋
  step('운동 시작')
  await open('/')
  await page.getByRole('button', { name: '운동 시작' }).tap()
  await page.getByRole('button', { name: '종목 추가', exact: true }).tap()
  await pick([BENCH, LAT, SQUAT])
  await visible(card(SQUAT), '종목 셋을 넣음')
  await visible(linkButton(BENCH, LAT), '카드 사이에 "슈퍼세트로 묶기"')
  await count(page.getByRole('button', { name: /슈퍼세트로 묶기$/ }), 2, '카드 사이마다 하나씩(둘)')
  await count(trays, 0, '아직 묶음 없음')
  check((await boxOf(linkButton(BENCH, LAT))).height >= 44, '묶기 버튼의 누르는 곳이 44px 이상')
  const gap = (await boxOf(card(LAT))).top - (await boxOf(card(BENCH))).bottom
  check(gap <= 24, `묶기 버튼이 카드 사이를 거의 넓히지 않음 (틈 ${gap}px)`)
  await noOverflow('운동 중(묶기 전)')
  await touchTargets(phone, '운동 중(묶기 전)', main)
  await shot('01-workout-unlinked')

  // ───────── 둘을 묶기
  step('둘을 묶기')
  await linkButton(BENCH, LAT).tap()
  await visible(unlinkButton(BENCH, LAT), '묶으면 그 자리가 "묶음 풀기"로 바뀜')
  await count(trays, 2, '묶인 카드 둘')
  await visible(tray('first').getByText('슈퍼세트', { exact: true }), '묶음 위에 "슈퍼세트"라고 적힘')
  await visible(tray('first').getByText(HINT), '언제 쉬는지 안내')
  await eventually(storedLayout, `[${BENCH} ${LAT}] ${SQUAT}`, '벤치프레스와 랫풀다운이 같은 묶음으로 저장됨')
  await oneUnit('둘 묶음', [BENCH, LAT])
  await visible(linkButton(LAT, SQUAT), '묶음 아래 종목과는 아직 묶을 수 있음')
  await noOverflow('운동 중(둘 묶음)')
  await touchTargets(phone, '운동 중(둘 묶음)', main)
  await shot('02-workout-pair')
  await shot('02-workout-pair-full', { fullPage: true })
  await narrow('운동 중(둘 묶음)', '03-workout-pair-narrow')

  // ───────── 휴식 타이머: 한 바퀴가 끝나야 쉰다
  step('휴식 타이머')
  // 벤치 카드를 길게 만들어 랫풀다운 카드가 화면 아래로 밀려나게 한다.
  await card(BENCH).getByRole('button', { name: '세트 추가' }).tap()
  await card(BENCH).getByRole('button', { name: '세트 추가' }).tap()
  await visible(doneButton(BENCH, 5), '벤치 5세트')
  await page.evaluate(() => window.scrollTo(0, 0))
  check(!(await inView(LAT)), '세트를 하기 전에는 랫풀다운 카드가 화면에 다 들어와 있지 않음')
  await doSet(BENCH, 1, 60, 10)
  await noRest('묶음의 앞 종목 세트를 완료해도 휴식 타이머가 뜨지 않음')
  await eventually(() => inView(LAT), true, '대신 다음 종목(랫풀다운) 카드가 화면에 들어옴')
  await shot('04-after-first-member')
  await doSet(LAT, 1, 50, 12)
  await visible(timer, '묶음의 마지막 종목 세트를 완료하면 휴식 타이머 시작')
  await shot('05-rest-after-round')
  // 쉬는 중에 다음 바퀴를 시작하면 돌던 타이머는 끝낸다.
  await doSet(BENCH, 2, 60, 9)
  await hidden(timer, '쉬는 중에 앞 종목 세트를 완료하면 돌던 타이머가 사라짐')
  await doSet(LAT, 2, 50, 11)
  await visible(timer, '두 번째 바퀴도 마지막 종목 뒤에 쉼')
  await skipRest()
  // 묶지 않은 종목은 늘 쉰다.
  await doSet(SQUAT, 1, 80, 5)
  await visible(timer, '묶지 않은 종목은 세트마다 쉼')
  await skipRest()
  // 웜업 세트는 바퀴에 들지 않는다: 묶음의 앞 종목이어도 다음 종목으로 넘어가지 않고 쉰다.
  await card(BENCH).getByRole('button', { name: '세트 추가' }).tap()
  await card(BENCH).getByRole('button', { name: /^6세트 설정/ }).tap()
  await page.getByRole('dialog', { name: '6세트 설정' }).getByRole('switch', { name: '웜업 세트' }).tap()
  await page.getByRole('dialog').getByRole('button', { name: '닫기' }).tap()
  await page.evaluate(() => window.scrollTo(0, 0))
  await doSet(BENCH, 'W', 40, 8)
  await visible(timer, '묶음 앞 종목의 웜업 세트를 완료하면 넘어가지 않고 쉼')
  await skipRest()

  // ───────── 셋을 묶기, 뒤쪽 종목에 남은 세트가 없으면 쉰다
  step('셋을 묶기')
  await linkButton(LAT, SQUAT).tap()
  await count(trays, 3, '묶인 카드 셋')
  await count(tray('middle'), 1, '가운데 종목')
  await eventually(storedLayout, `[${BENCH} ${LAT} ${SQUAT}]`, '셋이 한 묶음으로 저장됨')
  await oneUnit('셋 묶음', [BENCH, LAT, SQUAT])
  await count(main.getByText('슈퍼세트', { exact: true }), 1, '"슈퍼세트" 글은 묶음마다 한 번')
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('06-workout-three-full', { fullPage: true })
  // 랫풀다운의 남은 세트를 지우고 스쿼트의 남은 세트를 모두 완료하면, 벤치 세트 뒤에 할 종목이 없으니 쉰다.
  await card(LAT).getByRole('button', { name: '3세트 설정', exact: true }).tap()
  await page.getByRole('dialog', { name: '3세트 설정' }).getByRole('button', { name: '세트 삭제' }).tap()
  await count(card(LAT).getByRole('button', { name: /세트 완료$/ }), 2, '랫풀다운은 완료한 두 세트만 남음')
  await doSet(BENCH, 3, 60, 8)
  await noRest('뒤쪽 종목(스쿼트)에 할 세트가 남아 있으면 쉬지 않음')
  await eventually(() => inView(SQUAT), true, '세트를 다 한 랫풀다운은 건너뛰고 스쿼트 카드가 화면에 들어옴')
  await doSet(SQUAT, 2, 80, 5)
  await visible(timer, '묶음의 마지막 종목(스쿼트) 뒤에 쉼')
  await skipRest()
  await doSet(SQUAT, 3, 80, 4)
  await skipRest()
  await doSet(BENCH, 4, 60, 7)
  await visible(timer, '뒤쪽 종목에 남은 세트가 없으면 앞 종목 세트 뒤에도 쉼')
  await skipRest()

  // ───────── 옮기기
  step('옮기기')
  await card(SQUAT).getByRole('button', { name: '위로 옮기기' }).tap()
  await eventually(storedLayout, `[${BENCH} ${SQUAT} ${LAT}]`, '묶음 안에서 옮기면 자리만 바뀜')
  await card(LAT).getByRole('button', { name: '위로 옮기기' }).tap()
  await eventually(storedLayout, `[${BENCH} ${LAT} ${SQUAT}]`, '다시 원래 순서로')
  await card(SQUAT).getByRole('button', { name: '위로 옮기기' }).tap()
  await card(SQUAT).getByRole('button', { name: '위로 옮기기' }).tap()
  await eventually(storedLayout, `[${SQUAT} ${BENCH} ${LAT}]`, '맨 위까지 옮겨도 묶음 안이면 묶음 그대로')
  await card(SQUAT).getByRole('button', { name: '아래로 옮기기' }).tap()
  await card(SQUAT).getByRole('button', { name: '아래로 옮기기' }).tap()
  await eventually(storedLayout, `[${BENCH} ${LAT} ${SQUAT}]`, '다시 맨 아래로')

  // ───────── 풀기
  step('풀기')
  await unlinkButton(BENCH, LAT).tap()
  await eventually(storedLayout, `${BENCH} [${LAT} ${SQUAT}]`, '셋 가운데 위쪽 사이를 풀면 첫 종목만 빠짐')
  await count(trays, 2, '남은 둘은 묶음으로 보임')
  await visible(linkButton(BENCH, LAT), '푼 자리는 다시 "슈퍼세트로 묶기"')
  // 묶이지 않은 종목은 묶음을 통째로 건너뛴다.
  await card(BENCH).getByRole('button', { name: '아래로 옮기기' }).tap()
  await eventually(storedLayout, `[${LAT} ${SQUAT}] ${BENCH}`, '묶이지 않은 종목을 옮기면 묶음을 통째로 건너뜀')
  await card(BENCH).getByRole('button', { name: '위로 옮기기' }).tap()
  await eventually(storedLayout, `${BENCH} [${LAT} ${SQUAT}]`, '위로도 통째로 건너뜀')
  await unlinkButton(LAT, SQUAT).tap()
  await eventually(storedLayout, `${BENCH} ${LAT} ${SQUAT}`, '모두 풀림')
  await count(trays, 0, '묶음 표시가 사라짐')
  check((await workoutRows()).every((we) => we.supersetId === null), '혼자 남은 묶음 id가 저장소에 없음')
  await doSet(BENCH, 5, 60, 6)
  await visible(timer, '풀고 나면 벤치 세트 뒤에 다시 쉼')
  await skipRest()

  // 종목을 빼면 하나만 남은 묶음은 풀린다.
  await linkButton(LAT, SQUAT).tap()
  await eventually(storedLayout, `${BENCH} [${LAT} ${SQUAT}]`, '다시 둘을 묶음')
  await card(SQUAT).getByRole('button', { name: '빼기' }).tap()
  await page.getByRole('dialog', { name: `${SQUAT} 빼기` }).getByRole('button', { name: '빼기' }).tap()
  await eventually(storedLayout, `${BENCH} ${LAT}`, '묶음의 종목을 빼면 하나만 남은 묶음은 풀림')
  check((await workoutRows()).every((we) => we.supersetId === null), '빼고 난 뒤에도 혼자 남은 id가 없음')
  await count(trays, 0, '묶음 표시 없음')

  await page.getByRole('button', { name: '마치기' }).tap()
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '첫 운동을 마침')
  await count(trays, 0, '묶지 않고 마친 운동의 기록에는 묶음 표시가 없음')

  // ───────── 루틴에서 묶기
  step('루틴에서 묶기')
  await open('/routines/new')
  await page.getByLabel('루틴 이름').fill('상체 슈퍼세트')
  await page.getByRole('button', { name: '종목 추가' }).tap()
  await pick([BENCH, LAT, SQUAT])
  const row = (name) => page.getByRole('listitem', { name, exact: true })
  await visible(row(SQUAT), '루틴에 종목 셋')
  await linkButton(BENCH, LAT).tap()
  await count(trays, 2, '루틴에서도 묶인 종목이 한 덩어리로 보임')
  await visible(tray('first').getByText('슈퍼세트', { exact: true }), '루틴 묶음에도 "슈퍼세트"')
  await noOverflow('루틴 고치기(묶음)')
  await touchTargets(phone, '루틴 고치기(묶음)', main)
  await shot('07-routine-editor')
  await narrow('루틴 고치기(묶음)', '08-routine-editor-narrow')
  // 루틴에서도 묶이지 않은 종목은 묶음을 통째로 건너뛰고, 다시 내려온다.
  await row(SQUAT).getByRole('button', { name: `${SQUAT} 위로` }).tap()
  await count(page.getByRole('listitem').nth(0).getByText(SQUAT), 1, '스쿼트가 묶음 위로 올라감')
  await count(trays, 2, '묶음은 그대로')
  await row(SQUAT).getByRole('button', { name: `${SQUAT} 아래로` }).tap()
  // 셋을 묶었다가 아래쪽을 다시 푼다.
  await linkButton(LAT, SQUAT).tap()
  await count(trays, 3, '셋을 묶음')
  await unlinkButton(LAT, SQUAT).tap()
  await count(trays, 2, '아래쪽을 풀면 둘만 남음')
  await page.getByRole('button', { name: '저장', exact: true }).tap()
  await page.waitForURL((url) => !url.hash.includes('/routines/new'))
  await eventually(
    async () => layoutOf(await routineRows('상체 슈퍼세트')),
    `[${BENCH} ${LAT}] ${SQUAT}`,
    '루틴에 묶음이 저장됨',
 )
  check(!('supersetId' in (await routineRows('상체 슈퍼세트'))[2]), '묶지 않은 종목에는 묶음 값을 두지 않음')

  // 다시 열어도 묶음이 보이고, 고친 것이 없으면 그냥 나갈 수 있다.
  await open('/routines')
  await page.getByRole('link', { name: /^상체 슈퍼세트/ }).tap()
  await visible(page.getByRole('heading', { name: '루틴 고치기' }), '저장한 루틴을 다시 엶')
  await count(trays, 2, '다시 열어도 묶음이 보임')
  await page.getByRole('button', { name: '뒤로' }).tap()
  await hidden(page.getByRole('dialog', { name: '저장하지 않고 나갈까요?' }), '고친 것이 없으면 묻지 않고 나감')

  // ───────── 루틴으로 시작
  step('루틴으로 시작')
  await open('/')
  await page.getByRole('button', { name: '상체 슈퍼세트 루틴 시작' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '운동 화면')
  await count(trays, 2, '루틴의 묶음이 운동에 따라옴')
  await eventually(storedLayout, `[${BENCH} ${LAT}] ${SQUAT}`, '운동에도 같은 묶음으로 저장됨')
  const routineGroup = (await routineRows('상체 슈퍼세트'))[0].supersetId
  check((await workoutRows())[0].supersetId !== routineGroup, '운동의 묶음 id는 루틴과 따로 새로 만듦')
  await oneUnit('루틴으로 시작한 운동', [BENCH, LAT])
  await shot('09-workout-from-routine')
  // 지난번 값이 채워져 있어 완료만 누른다.
  await doneButton(BENCH, 1).tap()
  await attr(doneButton(BENCH, 1), 'aria-pressed', 'true', '벤치 1세트 완료')
  await noRest('루틴으로 시작한 묶음에서도 앞 종목 뒤에는 쉬지 않음')
  await doneButton(LAT, 1).tap()
  await visible(timer, '마지막 종목 뒤에 쉼')
  await skipRest()
  // 스쿼트는 첫 운동에서 빼서 지난 기록이 없다.
  await doSet(SQUAT, 1, 80, 5)
  await visible(timer, '묶지 않은 스쿼트는 세트 뒤에 쉼')
  await skipRest()
  const routineWorkout = workoutId()
  await page.getByRole('button', { name: '마치기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 완료' }), '운동 완료 화면')
  await page.getByRole('button', { name: '저장', exact: true }).tap()

  // ───────── 기록 상세
  step('기록 상세')
  await visible(page.getByRole('button', { name: '같은 운동 다시 하기' }), '기록 상세')
  check(workoutId() === routineWorkout, '방금 마친 운동의 기록')
  await count(trays, 2, '기록 상세에도 묶음이 보임')
  await visible(tray('first').getByText('슈퍼세트', { exact: true }), '기록 상세의 묶음에 "슈퍼세트"')
  await oneUnit('기록 상세', [BENCH, LAT])
  await count(page.getByRole('button', { name: /슈퍼세트(로 묶기| 풀기)$/ }), 0, '기록 상세에서는 묶거나 풀 수 없음(보기만)')
  await eventually(() => storedLayout(routineWorkout), `[${BENCH} ${LAT}] ${SQUAT}`, '마친 뒤에도 묶음이 저장돼 있음')
  await noOverflow('기록 상세(묶음)')
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot('10-history-detail')
  await shot('10-history-detail-full', { fullPage: true })

  // ───────── 루틴으로 저장, 다시 하기
  step('루틴으로 저장, 다시 하기')
  await page.getByRole('button', { name: '루틴으로 저장' }).tap()
  const saveDialog = page.getByRole('dialog', { name: '루틴으로 저장' })
  await saveDialog.getByLabel('루틴 이름').fill('기록에서 만든 루틴')
  await saveDialog.getByRole('button', { name: '저장' }).tap()
  await visible(page.getByRole('dialog', { name: '루틴으로 저장했습니다' }), '기록을 루틴으로 저장')
  await eventually(
    async () => layoutOf(await routineRows('기록에서 만든 루틴')),
    `[${BENCH} ${LAT}] ${SQUAT}`,
    '기록에서 만든 루틴에도 묶음이 담김',
 )
  await page.getByRole('dialog', { name: '루틴으로 저장했습니다' }).getByRole('button', { name: '닫기' }).tap()
  await page.getByRole('button', { name: '같은 운동 다시 하기' }).tap()
  await visible(page.getByRole('heading', { name: '운동 중' }), '같은 운동을 다시 시작')
  check(workoutId() !== routineWorkout, '새 운동')
  await eventually(storedLayout, `[${BENCH} ${LAT}] ${SQUAT}`, '다시 하는 운동에도 묶음이 따라옴')
  await count(trays, 2, '다시 하는 운동 화면에 묶음이 보임')
  await text(tray('first'), '슈퍼세트', '"슈퍼세트" 글')

  step('콘솔')
  phone.consoleClean()
}
