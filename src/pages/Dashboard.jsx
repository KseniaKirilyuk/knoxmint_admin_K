import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { 
  DollarSign, 
  TrendingUp, 
  Users, 
  ShoppingCart,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle
} from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import api from '../lib/api'

function StatCard({ title, value, subtitle, icon: Icon, trend, trendUp }) {
  return (
    <div className="card p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500 font-medium">{title}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
          {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        </div>
        <div className="p-3 bg-knox-50 rounded-xl">
          <Icon className="w-6 h-6 text-knox-600" />
        </div>
      </div>
      {trend && (
        <div className={`flex items-center gap-1 mt-3 text-sm ${trendUp ? 'text-emerald-600' : 'text-red-600'}`}>
          {trendUp ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          {trend}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [salesByGroup, setSalesByGroup] = useState([])
  const [salesOverTime, setSalesOverTime] = useState([])
  const [recentTransactions, setRecentTransactions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      const [statsRes, groupsRes, timeRes, recentRes] = await Promise.all([
        api.get('/dashboard?action=stats'),
        api.get('/dashboard?action=sales-by-group'),
        api.get('/dashboard?action=sales-over-time&groupBy=week'),
        api.get('/dashboard?action=recent-transactions&limit=5')
      ])
      
      setStats(statsRes.data)
      setSalesByGroup(groupsRes.data)
      setSalesOverTime(timeRes.data)
      setRecentTransactions(recentRes.data)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-knox-600"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">Overview of your coin sales and payouts</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Revenue"
          value={formatCurrency(stats?.sales?.total_revenue)}
          subtitle={`${stats?.sales?.total_transactions || 0} transactions`}
          icon={DollarSign}
        />
        <StatCard
          title="Total Profit"
          value={formatCurrency(stats?.sales?.total_profit)}
          subtitle={`Avg: ${formatCurrency(stats?.sales?.avg_profit)}`}
          icon={TrendingUp}
        />
        <StatCard
          title="Pending Payouts"
          value={formatCurrency(stats?.pendingPayouts?.pending_amount)}
          subtitle={`${stats?.pendingPayouts?.pending_count || 0} pending`}
          icon={Clock}
        />
        <StatCard
          title="Paid Out"
          value={formatCurrency(stats?.paidPayouts?.paid_amount)}
          subtitle={`${stats?.paidPayouts?.paid_count || 0} completed`}
          icon={CheckCircle}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Over Time */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Sales Over Time</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesOverTime}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="period" 
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => {
                    const date = new Date(value)
                    return `${date.getMonth() + 1}/${date.getDate()}`
                  }}
                />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip 
                  formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                />
                <Line 
                  type="monotone" 
                  dataKey="revenue" 
                  stroke="#0284c7" 
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales by Group */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Sales by Group</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesByGroup} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <YAxis 
                  type="category" 
                  dataKey="group_name" 
                  tick={{ fontSize: 12 }}
                  width={100}
                />
                <Tooltip formatter={(value) => [`$${value.toFixed(2)}`, 'Revenue']} />
                <Bar dataKey="total_revenue" fill="#0284c7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Transactions & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Transactions */}
        <div className="lg:col-span-2 card">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Recent Transactions</h2>
            <Link to="/sales" className="text-sm text-knox-600 hover:text-knox-700 font-medium">
              View all →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Date</th>
                  <th className="table-header">Listing</th>
                  <th className="table-header">Group</th>
                  <th className="table-header text-right">Sale Price</th>
                  <th className="table-header text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {recentTransactions.map((tx) => (
                  <tr key={tx.transaction_id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      {new Date(tx.sale_date).toLocaleDateString()}
                    </td>
                    <td className="table-cell font-mono text-xs">{tx.listing_id}</td>
                    <td className="table-cell">
                      <span className="px-2 py-1 bg-knox-50 text-knox-700 rounded text-xs font-medium">
                        {tx.group_name}
                      </span>
                    </td>
                    <td className="table-cell text-right">${parseFloat(tx.sale_price).toFixed(2)}</td>
                    <td className={`table-cell text-right font-medium ${parseFloat(tx.profit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      ${parseFloat(tx.profit).toFixed(2)}
                    </td>
                  </tr>
                ))}
                {recentTransactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="table-cell text-center text-slate-500">
                      No transactions yet. Import data to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link
              to="/upload"
              className="flex items-center gap-3 p-3 bg-knox-50 hover:bg-knox-100 rounded-lg transition-colors"
            >
              <div className="p-2 bg-knox-600 rounded-lg">
                <ShoppingCart className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-medium text-slate-900">Import Sales Data</p>
                <p className="text-xs text-slate-500">Upload Excel file</p>
              </div>
            </Link>
            <Link
              to="/payouts"
              className="flex items-center gap-3 p-3 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
            >
              <div className="p-2 bg-emerald-600 rounded-lg">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-medium text-slate-900">Process Payouts</p>
                <p className="text-xs text-slate-500">View amounts owed</p>
              </div>
            </Link>
            <Link
              to="/users"
              className="flex items-center gap-3 p-3 bg-slate-50 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <div className="p-2 bg-slate-600 rounded-lg">
                <Users className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-medium text-slate-900">Manage Users</p>
                <p className="text-xs text-slate-500">{stats?.activeUsers || 0} active members</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
