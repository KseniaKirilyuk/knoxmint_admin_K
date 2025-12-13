import { useState, useEffect } from 'react'
import { DollarSign, CheckCircle, Clock, ChevronDown, ChevronRight, Users, Download } from 'lucide-react'
import api from '../lib/api'

export default function Payouts() {
  const [memberTotals, setMemberTotals] = useState([])
  const [memberBreakdowns, setMemberBreakdowns] = useState({})
  const [paymentHistory, setPaymentHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('owed')
  const [expandedMembers, setExpandedMembers] = useState({})
  const [payModal, setPayModal] = useState(null)
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'Zelle', reference: '', notes: '' })

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [totalsRes, historyRes] = await Promise.all([
        api.get('/payouts?action=memberTotals'),
        api.get('/payouts?action=history')
      ])
      setMemberTotals(totalsRes.data)
      setPaymentHistory(historyRes.data)
    } catch (error) {
      console.error('Error fetching payout data:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleMember = async (userId) => {
    if (expandedMembers[userId]) {
      setExpandedMembers(prev => ({ ...prev, [userId]: false }))
    } else {
      // Fetch breakdown if not already loaded
      if (!memberBreakdowns[userId]) {
        try {
          const res = await api.get(`/payouts?action=memberBreakdown&userId=${userId}`)
          setMemberBreakdowns(prev => ({ ...prev, [userId]: res.data }))
        } catch (error) {
          console.error('Error fetching breakdown:', error)
        }
      }
      setExpandedMembers(prev => ({ ...prev, [userId]: true }))
    }
  }

  const openPayModal = (member) => {
    setPayModal(member)
    setPaymentForm({ 
      amount: parseFloat(member.balance || 0).toFixed(2), 
      method: 'Zelle', 
      reference: '', 
      notes: '' 
    })
  }

  const handlePayment = async () => {
    if (!payModal || !paymentForm.amount) return
    
    try {
      await api.post('/payouts', {
        userId: payModal.user_id,
        amount: parseFloat(paymentForm.amount),
        paymentMethod: paymentForm.method,
        paymentReference: paymentForm.reference,
        notes: paymentForm.notes
      })
      setPayModal(null)
      fetchData()
    } catch (error) {
      alert('Error recording payment: ' + (error.response?.data?.error || error.message))
    }
  }

  const exportCSV = () => {
    const headers = ['Member', 'Contributed', 'Total Earned', 'Paid', 'Balance']
    const rows = memberTotals.map(m => [
      m.full_name || m.username,
      m.total_contributed,
      parseFloat(m.total_earned || 0).toFixed(2),
      parseFloat(m.total_paid || 0).toFixed(2),
      parseFloat(m.balance || 0).toFixed(2)
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payouts_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const totalOwed = memberTotals.reduce((sum, m) => sum + parseFloat(m.total_earned || 0), 0)
  const totalUnpaid = memberTotals.reduce((sum, m) => sum + parseFloat(m.balance || 0), 0)
  const totalPaid = memberTotals.reduce((sum, m) => sum + parseFloat(m.total_paid || 0), 0)

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payouts</h1>
          <p className="text-slate-500 mt-1">Track and manage member payouts</p>
        </div>
        <button onClick={exportCSV} className="btn btn-secondary gap-2">
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-knox-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-knox-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Earned</p>
              <p className="text-xl font-bold text-slate-900">{formatCurrency(totalOwed)}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Unpaid Balance</p>
              <p className="text-xl font-bold text-amber-600">{formatCurrency(totalUnpaid)}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Paid</p>
              <p className="text-xl font-bold text-emerald-600">{formatCurrency(totalPaid)}</p>
            </div>
          </div>
        </div>
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <Users className="w-5 h-5 text-slate-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Members</p>
              <p className="text-xl font-bold text-slate-900">{memberTotals.length}</p>
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
            Member Balances
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
                <th className="table-header w-8"></th>
                <th className="table-header">Member</th>
                <th className="table-header text-right">Contributed</th>
                <th className="table-header text-right">Total Earned</th>
                <th className="table-header text-right">Paid</th>
                <th className="table-header text-right">Balance</th>
                <th className="table-header text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {memberTotals.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-cell text-center py-8 text-slate-500">
                    No member data found. Add contributions in Batches first.
                  </td>
                </tr>
              ) : (
                memberTotals.map((member) => {
                  const isExpanded = expandedMembers[member.user_id]
                  const breakdown = memberBreakdowns[member.user_id] || []
                  const balance = parseFloat(member.balance || 0)
                  
                  return (
                    <>
                      <tr 
                        key={member.user_id} 
                        className={`hover:bg-slate-50 cursor-pointer ${isExpanded ? 'bg-slate-50' : ''}`}
                        onClick={() => toggleMember(member.user_id)}
                      >
                        <td className="table-cell">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                          )}
                        </td>
                        <td className="table-cell">
                          <div>
                            <p className="font-medium text-slate-900">{member.full_name || member.username}</p>
                            <p className="text-xs text-slate-500">@{member.username}</p>
                          </div>
                        </td>
                        <td className="table-cell text-right">{member.total_contributed} coins</td>
                        <td className="table-cell text-right">{formatCurrency(member.total_earned)}</td>
                        <td className="table-cell text-right text-emerald-600">{formatCurrency(member.total_paid)}</td>
                        <td className="table-cell text-right">
                          {balance > 0 ? (
                            <span className="font-semibold text-amber-600">{formatCurrency(balance)}</span>
                          ) : (
                            <span className="text-slate-400">$0.00</span>
                          )}
                        </td>
                        <td className="table-cell text-right" onClick={(e) => e.stopPropagation()}>
                          {balance > 0 && (
                            <button
                              onClick={() => openPayModal(member)}
                              className="btn btn-primary text-xs py-1 px-3"
                            >
                              Pay
                            </button>
                          )}
                          {balance <= 0 && (
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs">
                              ✓ Paid
                            </span>
                          )}
                        </td>
                      </tr>
                      
                      {/* Expanded breakdown */}
                      {isExpanded && (
                        <tr key={`${member.user_id}-breakdown`}>
                          <td colSpan={7} className="p-0 border-t-0">
                            <div className="bg-slate-50 px-6 py-4">
                              {breakdown.length === 0 ? (
                                <p className="text-sm text-slate-500">No contributions found for this member.</p>
                              ) : (
                                <div className="bg-white rounded-lg border overflow-hidden">
                                  <table className="w-full text-sm">
                                    <thead>
                                      <tr className="bg-slate-100">
                                        <th className="px-4 py-2 text-left font-medium text-slate-600">Coin Type</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">You</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Total Pool</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Sold</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Your %</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Your Payout</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {breakdown.map((row, idx) => (
                                        <tr key={idx} className="border-t">
                                          <td className="px-4 py-2">
                                            <span className="font-medium text-slate-900">{row.coin_type_name}</span>
                                            {row.batch_name && (
                                              <span className="text-xs text-slate-400 ml-2">({row.batch_name})</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2 text-right">{row.user_contributed}</td>
                                          <td className="px-4 py-2 text-right text-slate-500">{row.total_for_coin}</td>
                                          <td className="px-4 py-2 text-right">
                                            {parseInt(row.total_sold) > 0 ? (
                                              <span className="text-emerald-600">{row.total_sold}</span>
                                            ) : (
                                              <span className="text-slate-400">0</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2 text-right">
                                            <span className="px-2 py-0.5 bg-knox-50 text-knox-700 rounded text-xs">
                                              {row.share_pct}%
                                            </span>
                                          </td>
                                          <td className="px-4 py-2 text-right font-medium">
                                            {parseFloat(row.user_payout) > 0 ? (
                                              <span className="text-emerald-600">{formatCurrency(row.user_payout)}</span>
                                            ) : (
                                              <span className="text-slate-400">$0.00</span>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t bg-slate-50">
                                        <td colSpan={5} className="px-4 py-2 text-right font-medium text-slate-600">
                                          Total Earned:
                                        </td>
                                        <td className="px-4 py-2 text-right font-bold text-emerald-600">
                                          {formatCurrency(breakdown.reduce((sum, r) => sum + parseFloat(r.user_payout || 0), 0))}
                                        </td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })
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
                <th className="table-header">Member</th>
                <th className="table-header text-right">Amount</th>
                <th className="table-header">Method</th>
                <th className="table-header">Reference</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {paymentHistory.length === 0 ? (
                <tr>
                  <td colSpan={6} className="table-cell text-center py-8 text-slate-500">
                    No payment history yet
                  </td>
                </tr>
              ) : (
                paymentHistory.map((payout) => (
                  <tr key={payout.payout_id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      {payout.payout_date?.split('T')[0]}
                    </td>
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-slate-900">{payout.full_name || payout.username}</p>
                        <p className="text-xs text-slate-500">@{payout.username}</p>
                      </div>
                    </td>
                    <td className="table-cell text-right font-medium text-emerald-600">
                      {formatCurrency(payout.amount)}
                    </td>
                    <td className="table-cell">{payout.payment_method || '-'}</td>
                    <td className="table-cell text-slate-500">{payout.payment_reference || '-'}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        payout.status === 'Paid' 
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
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

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <p className="text-sm text-slate-500">
                Pay {payModal.full_name || payModal.username}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    className="input pl-7"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Balance owed: {formatCurrency(payModal.balance)}
                </p>
              </div>
              <div>
                <label className="label">Payment Method</label>
                <select
                  className="input"
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                >
                  <option value="Zelle">Zelle</option>
                  <option value="PayPal">PayPal</option>
                  <option value="Venmo">Venmo</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Wire">Wire Transfer</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Reference # (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Transaction ID, check number, etc."
                  value={paymentForm.reference}
                  onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Any additional notes..."
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button onClick={() => setPayModal(null)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button onClick={handlePayment} className="btn btn-primary flex-1">
                  Record Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
