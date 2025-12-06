import { useAuth } from '../../hooks/useAuth'
import { LogOut, User, Bell } from 'lucide-react'

export default function Header() {
  const { user, logout } = useAuth()

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="lg:hidden">
          {/* Mobile menu button would go here */}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-4">
          {/* Notifications */}
          <button className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors">
            <Bell className="w-5 h-5" />
          </button>

          {/* User menu */}
          <div className="flex items-center gap-3 pl-4 border-l border-slate-200">
            <div className="text-right">
              <p className="text-sm font-medium text-slate-700">{user?.fullName || user?.username}</p>
              <p className="text-xs text-slate-500 capitalize">{user?.role}</p>
            </div>
            <div className="w-10 h-10 bg-knox-100 rounded-full flex items-center justify-center">
              <User className="w-5 h-5 text-knox-600" />
            </div>
            <button
              onClick={logout}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Sign out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
