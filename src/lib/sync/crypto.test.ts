import { describe, expect, it } from 'vitest'
import { generateCode } from './code'
import { deriveKeys, openBackup, sealBackup } from './crypto'
import { SyncError } from './errors'

const CODE = '0123456789ABCDEFGHJKMNPQR'
const JSON_TEXT = JSON.stringify({ format: 'health-log-backup', memo: '스쿼트 100kg', rows: Array(200).fill('벤치프레스') })

const includes = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text))

describe('복구 코드에서 만든 열쇠', () => {
  it('같은 코드면 같은 토큰, 다른 코드면 다른 토큰', async () => {
    const a = await deriveKeys(CODE)
    const again = await deriveKeys(CODE)
    const other = await deriveKeys(generateCode())
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(again.token).toBe(a.token)
    expect(other.token).not.toBe(a.token)
    // 토큰에서 코드가 보이지 않는다.
    expect(a.token).not.toContain(CODE.slice(0, 8))
  })

  it('암호화 키는 꺼낼 수 없고, 토큰과 다른 값이다', async () => {
    const { key, token } = await deriveKeys(CODE)
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 })
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow()
    // 토큰(서버가 아는 값)을 키로 써서는 풀리지 않는다.
    const sealed = await sealBackup(key, JSON_TEXT)
    const raw = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    const tokenAsKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt'])
    await expect(openBackup(tokenAsKey, sealed)).rejects.toMatchObject({ code: 'decrypt_failed' })
  })
})

describe('백업 암호화', () => {
  it('암호화한 것을 같은 코드로 풀면 그대로 돌아온다', async () => {
    const { key } = await deriveKeys(CODE)
    const sealed = await sealBackup(key, JSON_TEXT)
    expect(Array.from(sealed.subarray(0, 4))).toEqual([0x48, 0x4c, 0x42, 1])
    expect(await openBackup(key, sealed)).toBe(JSON_TEXT)
    // 다른 기기에서 같은 코드로 만든 키로도 풀린다.
    expect(await openBackup((await deriveKeys(CODE)).key, sealed)).toBe(JSON_TEXT)
  })

  it('서버에 가는 바이트에는 내용이 보이지 않고, 압축되어 있다', async () => {
    const { key } = await deriveKeys(CODE)
    const sealed = await sealBackup(key, JSON_TEXT)
    expect(includes(sealed, 'health-log-backup')).toBe(false)
    expect(includes(sealed, '스쿼트')).toBe(false)
    expect(sealed.length).toBeLessThan(new TextEncoder().encode(JSON_TEXT).length / 2)
  })

  it('같은 내용도 올릴 때마다 다른 바이트가 된다(IV가 매번 다르다)', async () => {
    const { key } = await deriveKeys(CODE)
    const [a, b] = [await sealBackup(key, JSON_TEXT), await sealBackup(key, JSON_TEXT)]
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('다른 코드로는 풀리지 않고 SyncError로 끝난다', async () => {
    const sealed = await sealBackup((await deriveKeys(CODE)).key, JSON_TEXT)
    const wrong = (await deriveKeys('1123456789ABCDEFGHJKMNPQR')).key
    const error = await openBackup(wrong, sealed).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SyncError)
    expect(error).toMatchObject({ code: 'decrypt_failed', message: 'decrypt_failed' })
  })

  it('바이트가 바뀌었거나 잘렸으면 풀지 않는다', async () => {
    const { key } = await deriveKeys(CODE)
    const sealed = await sealBackup(key, JSON_TEXT)
    for (const at of [0, 3, 4, 20, sealed.length - 1]) {
      const broken = sealed.slice()
      broken[at] ^= 1
      await expect(openBackup(key, broken)).rejects.toMatchObject({ code: 'decrypt_failed' })
    }
    // 형식 버전(3번 바이트)이 이 앱이 아는 것보다 크면 더 새 앱이 올린 것으로 본다.
    const newer = sealed.slice()
    newer[3] = 2
    await expect(openBackup(key, newer)).rejects.toMatchObject({ code: 'newer_format' })
    await expect(openBackup(key, sealed.subarray(0, 30))).rejects.toMatchObject({ code: 'decrypt_failed' })
    await expect(openBackup(key, new Uint8Array(0))).rejects.toMatchObject({ code: 'decrypt_failed' })
    await expect(openBackup(key, new TextEncoder().encode('<!doctype html>'))).rejects.toMatchObject({
      code: 'decrypt_failed',
    })
  })
})
