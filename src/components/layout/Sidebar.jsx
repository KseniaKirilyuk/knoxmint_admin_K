import { NavLink } from 'react-router-dom'
import { 
  LayoutDashboard, 
  ShoppingCart, 
  Wallet, 
  Users, 
  FolderKanban, 
  Upload, 
  Settings,
  Coins,
  PieChart
} from 'lucide-react'

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Sales', href: '/sales', icon: ShoppingCart },
  { name: 'Payouts', href: '/payouts', icon: Wallet },
  { name: 'Users', href: '/users', icon: Users },
  { name: 'Groups', href: '/groups', icon: FolderKanban },
  { name: 'Contributions', href: '/contributions', icon: PieChart },
  { name: 'Import Data', href: '/upload', icon: Upload },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export default function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 hidden lg:block">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
        <div className="p-2 bg-gold-500 rounded-lg">
          <Coins className="w-6 h-6 text-slate-900" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">KnoxMint</h1>
          <p className="text-xs text-slate-400">Admin Dashboard</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 py-4 space-y-1">
        {navigation.map((item) => (
          <NavLink
            key={item.name}
            to={item.href}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-knox-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            {item.name}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-800">
        <div className="text-xs text-slate-500">
          <p>KnoxMint Admin v1.0</p>
          <p className="mt-1">Phase 1: Excel Integration</p>
        </div>
      </div>
    </aside>
  )
}
