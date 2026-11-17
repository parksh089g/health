import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import { useAutoSync } from './lib/sync/useAutoSync'
import BodyWeightLog from './pages/BodyWeightLog'
import ExercisePicker from './pages/ExercisePicker'
import History from './pages/History'
import HistoryDetail from './pages/HistoryDetail'
import Home from './pages/Home'
import RoutineEditor from './pages/RoutineEditor'
import Routines from './pages/Routines'
import Settings from './pages/Settings'
import WorkoutDone from './pages/WorkoutDone'
import WorkoutPage from './pages/WorkoutPage'
import { RestTimerProvider } from './rest/RestTimerProvider'

// 차트가 있는 화면은 처음 열 때 따로 불러온다(첫 화면을 가볍게). 오프라인에서도 미리 받아 둔 파일로 열린다.
const Stats = lazy(() => import('./pages/Stats'))
const ExerciseDetail = lazy(() => import('./pages/ExerciseDetail'))

/** 아래에 탭이 있는 화면(홈, 기록, 설정)의 틀 */
function TabLayout() {
  return (
    <>
      <main className="flex-1 pb-28 pt-[env(safe-area-inset-top)]">
        <Outlet />
      </main>
      <TabBar />
    </>
  )
}

/**
 * 새 화면으로 들어갈 때는 맨 위에서 시작한다(긴 화면의 아래쪽에서 눌러도 다음 화면이 중간부터 보이지 않게).
 * 뒤로 가기로 돌아온 화면은 건드리지 않는다.
 */
function ScrollToTop() {
  const { pathname } = useLocation()
  const type = useNavigationType()
  useEffect(() => {
    if (type !== 'POP') window.scrollTo(0, 0)
  }, [pathname, type])
  return null
}

export default function App() {
  // 클라우드 백업이 켜져 있으면 바뀐 기록을 알아서 올린다.
  useAutoSync()
  return (
    <RestTimerProvider>
      {/* 해시 주소(#/history)를 써서 어떤 정적 호스팅에 올려도 별도 설정 없이 동작한다. */}
      <HashRouter>
        <ScrollToTop />
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
          <Suspense fallback={null}>
            <Routes>
              <Route element={<TabLayout />}>
                <Route index element={<Home />} />
                <Route path="history" element={<History />} />
                <Route path="stats" element={<Stats />} />
                <Route path="settings" element={<Settings />} />
              </Route>
              <Route path="workout/:id" element={<WorkoutPage />} />
              <Route path="workout/:id/pick" element={<ExercisePicker />} />
              <Route path="workout/:id/done" element={<WorkoutDone />} />
              <Route path="history/:id" element={<HistoryDetail />} />
              {/* 2단계 */}
              <Route path="exercises/:id" element={<ExerciseDetail />} />
              <Route path="routines" element={<Routines />} />
              <Route path="routines/:id" element={<RoutineEditor />} />
              <Route path="body-weight" element={<BodyWeightLog />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      </HashRouter>
    </RestTimerProvider>
  )
}
