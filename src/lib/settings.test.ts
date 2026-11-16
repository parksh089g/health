import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { SETTING_KEYS, getRecommendEnabled, setSetting } from './settings'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('다음 무게 추천 설정', () => {
  it('기본은 켜짐이고, 끄면 꺼진다', async () => {
    expect(await getRecommendEnabled()).toBe(true)
    await setSetting(SETTING_KEYS.recommendEnabled, false)
    expect(await getRecommendEnabled()).toBe(false)
    await setSetting(SETTING_KEYS.recommendEnabled, true)
    expect(await getRecommendEnabled()).toBe(true)
  })

  it('저장된 값이 이상하면 켜짐으로 본다', async () => {
    await setSetting(SETTING_KEYS.recommendEnabled, 'off')
    expect(await getRecommendEnabled()).toBe(true)
  })
})
