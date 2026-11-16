let audio: AudioContext | null = null

/**
 * 소리를 낼 수 있게 준비한다. 브라우저는 사용자가 화면을 누른 뒤에만 소리를 허용하므로,
 * 세트 완료 버튼을 누를 때 불러 둔다.
 */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext()
    // 멈추는 중일 수도 있으니 상태와 상관없이 다시 켠다.
    audio.resume().catch(() => undefined)
  } catch {
    // 소리를 못 내는 환경이면 진동과 화면 표시만 쓴다.
  }
}

/** 타이머가 없을 때는 오디오를 멈춰 둔다(배터리를 쓰지 않게). 다음 휴식을 시작할 때 다시 켠다. */
export function releaseAudio(): void {
  try {
    audio?.suspend().catch(() => undefined)
  } catch {
    // 소리를 못 내는 환경
  }
}

function beep(): void {
  if (!audio || audio.state !== 'running') return
  const start = audio.currentTime
  for (const offset of [0, 0.28, 0.56]) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2)
    osc.connect(gain).connect(audio.destination)
    osc.start(start + offset)
    osc.stop(start + offset + 0.22)
  }
}

/** 휴식이 끝났음을 진동과 소리로 알린다. 지원하지 않는 기기에서는 조용히 넘어간다. */
export function alertRestOver(): void {
  try {
    navigator.vibrate?.([250, 120, 250])
  } catch {
    // 진동을 지원하지 않는 기기
  }
  try {
    beep()
  } catch {
    // 소리를 못 내는 환경
  }
}
