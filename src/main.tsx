import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import './index.css'
import { ensureSeedExercises } from './lib/exercises'

// 한 번 연 뒤에는 인터넷 없이도 열린다. 새 버전이 올라와 있으면 앱을 열었을 때 받아서 자동으로 새로고침한다.
registerSW({ immediate: true })

// 기본 종목이 비어 있으면 채운다.
ensureSeedExercises().catch((e: unknown) => console.error('기본 종목을 넣지 못했습니다.', e))

// 브라우저가 저장 공간을 임의로 비우지 않도록 요청한다. 거절돼도 앱은 그대로 동작한다.
navigator.storage?.persist?.().catch(() => undefined)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
