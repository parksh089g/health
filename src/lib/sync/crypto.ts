import { SyncError } from './errors'

/**
 * 복구 코드에서 열쇠를 만들고 백업을 암호화한다. (5단계)
 * HKDF-SHA-256으로 서로 상관없는 두 값을 뽑는다. 토큰은 서버에 보내고, 암호화 키는 폰 밖으로 나가지 않는다.
 * 올리는 바이트: 머리 4바이트("HLB" + 형식 버전) + IV 12바이트 + AES-GCM(gzip(백업 JSON)).
 * 서버는 암호문만 갖고 있어서 복구 코드 없이는 내용을 볼 수 없다.
 */

const SALT = 'health-log-sync/v1'
const INFO_AUTH = 'auth-token'
const INFO_ENC = 'backup-encryption'
const FORMAT_VERSION = 1
const HEADER = new Uint8Array([0x48, 0x4c, 0x42, FORMAT_VERSION])
const IV_BYTES = 12

type Bytes = Uint8Array<ArrayBuffer>

export interface SyncKeys {
  /** 서버에 보내는 토큰(base64url 43자). 서버는 이 값의 SHA-256만 갖고 있다. */
  token: string
  /** 백업을 암호화하는 키. 꺼낼 수 없게 만든다. */
  key: CryptoKey
}

const utf8 = (text: string): Bytes => new TextEncoder().encode(text) as Bytes

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** 암호화(WebCrypto)와 압축(CompressionStream)을 쓸 수 있는 브라우저인지 */
export function cryptoSupported(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    crypto.subtle !== undefined &&
    typeof CompressionStream !== 'undefined' &&
    typeof DecompressionStream !== 'undefined'
  )
}

/** 복구 코드(끊는 줄 없는 25자)에서 토큰과 암호화 키를 만든다. 같은 코드면 늘 같은 값이 나온다. */
export async function deriveKeys(code: string): Promise<SyncKeys> {
  if (!cryptoSupported()) throw new SyncError('unsupported')
  const base = await crypto.subtle.importKey('raw', utf8(code), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: utf8(SALT), info: utf8(info) })
  const token = base64Url(new Uint8Array(await crypto.subtle.deriveBits(params(INFO_AUTH), base, 256)))
  const key = await crypto.subtle.deriveKey(params(INFO_ENC), base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return { token, key }
}

async function throughStream(bytes: Bytes, stream: CompressionStream | DecompressionStream): Promise<Bytes> {
  const piped = new Blob([bytes]).stream().pipeThrough(stream as ReadableWritablePair<Uint8Array, Uint8Array>)
  return new Uint8Array(await new Response(piped).arrayBuffer())
}

/** 백업 JSON을 압축하고 암호화해서 올릴 바이트로 만든다. */
export async function sealBackup(key: CryptoKey, json: string): Promise<Bytes> {
  const packed = await throughStream(utf8(json), new CompressionStream('gzip'))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const params = { name: 'AES-GCM', iv, additionalData: HEADER }
  const sealed = new Uint8Array(await crypto.subtle.encrypt(params, key, packed))
  const out = new Uint8Array(HEADER.length + IV_BYTES + sealed.length)
  out.set(HEADER, 0)
  out.set(iv, HEADER.length)
  out.set(sealed, HEADER.length + IV_BYTES)
  return out
}

/** 받은 바이트를 풀어 백업 JSON으로 되돌린다. 코드가 다르거나 바이트가 깨졌으면 SyncError를 던진다. */
export async function openBackup(key: CryptoKey, bytes: Uint8Array): Promise<string> {
  const head = bytes.subarray(0, HEADER.length)
  if (head.length < HEADER.length || head[0] !== HEADER[0] || head[1] !== HEADER[1] || head[2] !== HEADER[2]) {
    throw new SyncError('decrypt_failed')
  }
  if (head[3] > FORMAT_VERSION) throw new SyncError('newer_format')
  const iv = bytes.slice(HEADER.length, HEADER.length + IV_BYTES) as Bytes
  const sealed = bytes.slice(HEADER.length + IV_BYTES) as Bytes
  try {
    const additionalData = head.slice() as Bytes
    const packed = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, sealed))
    return new TextDecoder().decode(await throughStream(packed, new DecompressionStream('gzip')))
  } catch {
    throw new SyncError('decrypt_failed')
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
