import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * 뒤로 가기. 앱 안에서 넘어온 화면이면 한 단계 뒤로 가고,
 * 주소를 직접 열어서 돌아갈 곳이 없으면 fallback으로 간다.
 */
export function useGoBack(fallback: string): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(fallback, { replace: true })
  }, [navigate, fallback])
}
