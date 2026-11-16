import { NavLink } from 'react-router-dom'
import { HistoryIcon, HomeIcon, SettingsIcon } from './icons'

const TABS = [
  { to: '/', label: '홈', Icon: HomeIcon, end: true },
  { to: '/history', label: '기록', Icon: HistoryIcon, end: false },
  { to: '/settings', label: '설정', Icon: SettingsIcon, end: false },
]

export function TabBar() {
  return (
    <nav
      aria-label="주요 화면"
      className="fixed inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-3">
        {TABS.map(({ to, label, Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex h-16 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  isActive ? 'text-accent' : 'text-muted'
                }`
              }
            >
              <Icon className="size-6" />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}
