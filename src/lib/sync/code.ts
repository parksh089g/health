/**
 * 클라우드 백업의 복구 코드. (5단계)
 * 폰에서 무작위로 만든 25자(125비트)이고, 이 코드에서 서버에 보내는 토큰과 암호화 키가 나온다(crypto.ts).
 * 손으로 옮겨 적기 쉽게 헷갈리는 글자(I, L, O, U)를 뺀 32글자만 쓰고 다섯 자씩 끊어 보여 준다.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const CODE_LENGTH = 25
const GROUP = 5

/** 새 복구 코드(끊는 줄 없이 25자). */
export function generateCode(): string {
  // 한 글자가 5비트다. 256은 32로 나누어떨어지므로 바이트의 아래 5비트를 쓰면 고르게 뽑힌다.
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('')
}

/** 화면에 보여 줄 모양. "ABCDE-FGHJK-MNPQR-STVWX-YZ012" */
export function formatCode(code: string): string {
  return code.match(new RegExp(`.{1,${GROUP}}`, 'g'))?.join('-') ?? ''
}

/**
 * 손으로 적은 코드를 저장하는 모양으로 바꾼다. 맞는 코드가 아니면 null.
 * 띄어쓰기와 줄은 버리고, 소문자는 대문자로, 헷갈려 적기 쉬운 O는 0으로, I와 L은 1로 읽는다.
 */
export function normalizeCode(input: string): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (code.length !== CODE_LENGTH) return null
  return [...code].every((ch) => ALPHABET.includes(ch)) ? code : null
}
