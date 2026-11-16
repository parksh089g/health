import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { TabBar } from './components/TabBar'
import ExerciseDetail from './pages/ExerciseDetail'
import ExercisePicker from './pages/ExercisePicker'
import History from './pages/History'
import HistoryDetail from './pages/HistoryDetail'
import Home from './pages/Home'
import RoutineEditor from './pages/RoutineEditor'
import Routines from './pages/Routines'
import Settings from './pages/Settings'
import Stats from './pages/Stats'
import WorkoutDone from './pages/WorkoutDone'
import WorkoutPage from './pages/WorkoutPage'
import { RestTimerProvider } from './rest/RestTimerProvider'

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

export default function App() {
  return (
    <RestTimerProvider>
      {/* 해시 주소(#/history)를 써서 어떤 정적 호스팅에 올려도 별도 설정 없이 동작한다. */}
      <HashRouter>
        <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </HashRouter>
    </RestTimerProvider>
  )
}
