import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { User, Lock, Database, Zap } from 'lucide-react'
import api from '../lib/api'

export default function Settings() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('profile')
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: ''
  })
  const [message, setMessage] = useState({ type: '', text: '' })
  const [loading, setLoading] = useState(false)

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    
    if (passwords.new !== passwords.confirm) {
      setMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }

    if (passwords.new.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.new
      })
      setMessage({ type: 'success', text: 'Password updated successfully' })
      setPasswords({ current: '', new: '', confirm: '' })
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || 'Error updating password' 
      })
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'database', label: 'Database', icon: Database },
    { id: 'integrations', label: 'Integrations', icon: Zap }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">Manage your account and application settings</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-knox-50 text-knox-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'profile' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Profile Information</h2>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="label">Username</label>
                  <input
                    type="text"
                    className="input bg-slate-50"
                    value={user?.username || ''}
                    disabled
                  />
                </div>
                <div>
                  <label className="label">Full Name</label>
                  <input
                    type="text"
                    className="input"
                    defaultValue={user?.fullName || ''}
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    defaultValue={user?.email || ''}
                  />
                </div>
                <div>
                  <label className="label">Role</label>
                  <input
                    type="text"
                    className="input bg-slate-50 capitalize"
                    value={user?.role || ''}
                    disabled
                  />
                </div>
                <button className="btn btn-primary mt-4">
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Change Password</h2>
              
              {message.text && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  message.type === 'error' 
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
                <div>
                  <label className="label">Current Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwords.current}
                    onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">New Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwords.new}
                    onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                    required
                  />
                </div>
                <button 
                  type="submit" 
                  className="btn btn-primary mt-4"
                  disabled={loading}
                >
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'database' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Database Management</h2>
              <div className="space-y-6">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <h3 className="font-medium text-slate-900 mb-2">Database Status</h3>
                  <div className="flex items-center gap-2 text-emerald-600">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                    <span className="text-sm">Connected</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <h3 className="font-medium text-slate-900">Data Management</h3>
                  <div className="flex gap-3">
                    <button className="btn btn-secondary">
                      Export All Data
                    </button>
                    <button className="btn btn-secondary">
                      Backup Database
                    </button>
                  </div>
                </div>

                <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                  <h3 className="font-medium text-red-800 mb-2">Danger Zone</h3>
                  <p className="text-sm text-red-600 mb-3">
                    These actions are irreversible. Please be careful.
                  </p>
                  <button className="btn btn-danger">
                    Reset Database
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Integrations</h2>
              
              <div className="space-y-4">
                {/* eBay Integration */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 font-bold text-sm">eBay</span>
                      </div>
                      <div>
                        <h3 className="font-medium">eBay API</h3>
                        <p className="text-sm text-slate-500">Sync sales automatically</p>
                      </div>
                    </div>
                    <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                      Phase 2
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mb-3">
                    Connect your eBay seller account to automatically import sales transactions.
                  </p>
                  <button className="btn btn-secondary" disabled>
                    Configure (Coming Soon)
                  </button>
                </div>

                {/* Export Integration */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
                        <span className="text-emerald-600 font-bold text-sm">XLS</span>
                      </div>
                      <div>
                        <h3 className="font-medium">Excel Export</h3>
                        <p className="text-sm text-slate-500">Export data to Excel</p>
                      </div>
                    </div>
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">
                      Active
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mb-3">
                    Export sales, payouts, and reports to Excel format.
                  </p>
                  <button className="btn btn-secondary">
                    Export Settings
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
