import { useState, useEffect } from 'react'
import { DollarSign, CheckCircle, Clock, XCircle, Filter } from 'lucide-react'
import api from '../lib/api'

export default function Payouts() {
  const [amountsOwed, setAmountsOwed] = useState([])
  const [payoutHistory, setPayoutHistory] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('owed')
  const [selectedGroup, setSelectedGroup] = useState('')

  useEffect(() => {
    fetchData()
  }, [selectedGroup])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [owedRes, historyRes, groupsRes] = await Promise.all([
        api.get(`/payouts?action=owed${selectedGroup ? `&groupId=${selectedGroup}` : ''}`),
        api.get('/payouts?status=Paid&limit=50'),
        api.get('/groups')
      ])
      setAmountsOwed(owedRes.data)
      setPayoutHistory(historyRes.data)
      setGroups(groupsRes.data)
    } catch (error) {
      console.error('Error fetching payout data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleMarkPaid = async (userId, groupId, amount) => {
    try {
      await api.post('/payouts', {
        userId,
        groupId,
        amount,
        paymentMethod: 'Manual'
      })
      await api.put(`/payouts/${userId}/pay`) // This would need the payout ID
      fetchData()
    } catch (error) {
      console.error('Error marking as paid:', error)
    }
  }

  const totalOwed = amountsOwed.reduce((sum, row) => sum + parseFloat(row.amount_owed || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payouts</h1>
          <p className="text-slate-500 mt-1">Track and manage member payouts</p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-100 rounded-xl">
              <Clock className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Owed</p>
              <p className="text-2xl font-bold text-slate-900">${totalOwed.toFixed(2)}</p>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-emerald-100 rounded-xl">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Users with Balance</p>
              <p className="text-2xl font-bold text-slate-900">{amountsOwed.length}</p>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-knox-100 rounded-xl">
              <DollarSign className="w-6 h-6 text-knox-600" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Active Groups</p>
              <p className="text-2xl font-bold text-slate-900">{groups.filter(g => g.status === 'Active').length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-8">
          <button
            onClick={() => setActiveTab('owed')}
            className={`pb-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'owed'
                ? 'border-knox-600 text-knox-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Amounts Owed
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-4 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'history'
                ? 'border-knox-600 text-knox-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Payment History
          </button>
        </nav>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-4">
        <Filter className="w-4 h-4 text-slate-400" />
        <select
          className="input w-auto"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
        >
          <option value="">All Groups</option>
          {groups.map(g => (
            <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600"></div>
        </div>
      ) : activeTab === 'owed' ? (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">User</th>
                <th className="table-header">Group</th>
                <th className="table-header text-right">Transactions</th>
                <th className="table-header text-right">Amount Owed</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {amountsOwed.length === 0 ? (
                <tr>
                  <td colSpan={5} className="table-cell text-center py-8 text-slate-500">
                    No outstanding balances
                  </td>
                </tr>
              ) : (
                amountsOwed.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-slate-900">{row.username}</p>
                        <p className="text-xs text-slate-500">{row.full_name}</p>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className="px-2 py-1 bg-knox-50 text-knox-700 rounded text-xs font-medium">
                        {row.group_name}
                      </span>
                    </td>
                    <td className="table-cell text-right">{row.transaction_count}</td>
                    <td className="table-cell text-right font-semibold text-emerald-600">
                      ${parseFloat(row.amount_owed).toFixed(2)}
                    </td>
                    <td className="table-cell text-right">
                      <button
                        onClick={() => handleMarkPaid(row.user_id, row.group_id, row.amount_owed)}
                        className="btn btn-success text-xs py-1 px-3"
                      >
                        Mark Paid
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">User</th>
                <th className="table-header">Group</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Method</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {payoutHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="table-cell text-center py-8 text-slate-500">
                    No payment history yet
                  </td>
                </tr>
              ) : (
                payoutHistory.map((payout) => (
                  <tr key={payout.payout_id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      {payout.payout_date ? payout.payout_date.split('T')[0].replace(/(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => `${parseInt(m)}/${parseInt(d)}/${y}`) : '-'}
                    </td>
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-slate-900">{payout.username}</p>
                        <p className="text-xs text-slate-500">{payout.full_name}</p>
                      </div>
                    </td>
                    <td className="table-cell">{payout.group_name}</td>
                    <td className="table-cell text-right font-medium">
                      ${parseFloat(payout.amount).toFixed(2)}
                    </td>
                    <td className="table-cell">{payout.payment_method || '-'}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        payout.status === 'Paid' 
                          ? 'bg-emerald-100 text-emerald-700'
                          : payout.status === 'Pending'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {payout.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
