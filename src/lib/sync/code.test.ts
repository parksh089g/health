import { describe, expect, it } from 'vitest'
import { CODE_LENGTH, formatCode, generateCode, normalizeCode } from './code'

describe('복구 코드', () => {
  it('헷갈리는 글자가 없는 25자를 만든다', () => {
    const codes = Array.from({ length: 200 }, generateCode)
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{25}$/)
    expect(CODE_LENGTH * 5).toBeGreaterThanOrEqual(100)
    expect(new Set(codes).size).toBe(codes.length)
    // 32글자가 고르게 쓰인다(5000자에서 한 글자도 빠지지 않는다).
    expect(new Set(codes.join('')).size).toBe(32)
  })

  it('다섯 자씩 끊어 보여 준다', () => {
    expect(formatCode('0123456789ABCDEFGHJKMNPQR')).toBe('01234-56789-ABCDE-FGHJK-MNPQR')
  })

  it('손으로 적은 코드를 알아본다', () => {
    const code = '0123456789ABCDEFGHJKMNPQR'
    expect(normalizeCode(formatCode(code))).toBe(code)
    expect(normalizeCode('  01234 56789 abcde fghjk mnpqr\n')).toBe(code)
    // O는 0으로, I와 L은 1로 읽는다.
    expect(normalizeCode('O123456789ABCDEFGHJKMNPQR')).toBe(code)
    expect(normalizeCode('0I23456789ABCDEFGHJKMNPQR')).toBe(code)
    expect(normalizeCode('0l23456789ABCDEFGHJKMNPQR')).toBe(code)
    expect(normalizeCode(generateCode())).not.toBeNull()
  })

  it('길이가 다르거나 쓰지 않는 글자가 있으면 받지 않는다', () => {
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode('0123456789ABCDEFGHJKMNPQ')).toBeNull()
    expect(normalizeCode('0123456789ABCDEFGHJKMNPQRS')).toBeNull()
    expect(normalizeCode('U123456789ABCDEFGHJKMNPQR')).toBeNull()
    expect(normalizeCode('0123456789ABCDEFGHJKMNPQ!')).toBeNull()
  })
})
