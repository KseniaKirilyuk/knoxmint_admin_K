import { useState, useEffect } from 'react'
import { DollarSign, CheckCircle, Clock, ChevronDown, ChevronRight, Users, Download, Pencil, Trash2 } from 'lucide-react'
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
  const [editModal, setEditModal] = useState(null)
  const [editForm, setEditForm] = useState({ amount: '', method: '', reference: '', notes: '', payoutDate: '' })

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

  const openPayModal = async (member) => {
    setPayModal(member)
    setPaymentForm({ 
      amount: parseFloat(member.balance || 0).toFixed(2), 
      method: 'ACH', 
      reference: '', 
      notes: '',
      paymentType: 'total', // 'total', 'byCoin', 'custom'
      selectedCoins: {}
    })
    
    // Fetch breakdown if not already loaded
    if (!memberBreakdowns[member.user_id]) {
      try {
        const res = await api.get(`/payouts?action=memberBreakdown&userId=${member.user_id}`)
        setMemberBreakdowns(prev => ({ ...prev, [member.user_id]: res.data }))
      } catch (error) {
        console.error('Error fetching breakdown:', error)
      }
    }
  }

  const updatePaymentType = (type) => {
    if (!payModal) return
    const breakdown = memberBreakdowns[payModal.user_id] || []
    
    if (type === 'total') {
      setPaymentForm(prev => ({
        ...prev,
        paymentType: type,
        amount: parseFloat(payModal.balance || 0).toFixed(2),
        selectedCoins: {}
      }))
    } else if (type === 'byCoin') {
      // Pre-select all coins with positive payouts
      const selected = {}
      breakdown.forEach(row => {
        if (parseFloat(row.user_payout) > 0) {
          selected[row.coin_type_id] = true
        }
      })
      const total = breakdown
        .filter(row => selected[row.coin_type_id])
        .reduce((sum, row) => sum + Math.max(0, parseFloat(row.user_payout || 0)), 0)
      setPaymentForm(prev => ({
        ...prev,
        paymentType: type,
        amount: total.toFixed(2),
        selectedCoins: selected
      }))
    } else {
      setPaymentForm(prev => ({
        ...prev,
        paymentType: type,
        amount: '',
        selectedCoins: {}
      }))
    }
  }

  const toggleCoinSelection = (coinTypeId, userPayout) => {
    if (!payModal) return
    const breakdown = memberBreakdowns[payModal.user_id] || []
    
    const newSelected = { ...paymentForm.selectedCoins }
    if (newSelected[coinTypeId]) {
      delete newSelected[coinTypeId]
    } else {
      newSelected[coinTypeId] = true
    }
    
    const total = breakdown
      .filter(row => newSelected[row.coin_type_id])
      .reduce((sum, row) => sum + Math.max(0, parseFloat(row.user_payout || 0)), 0)
    
    setPaymentForm(prev => ({
      ...prev,
      selectedCoins: newSelected,
      amount: total.toFixed(2)
    }))
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

  const openEditModal = (payout) => {
    setEditModal(payout)
    setEditForm({
      amount: parseFloat(payout.amount || 0).toFixed(2),
      method: payout.payment_method || 'ACH',
      reference: payout.payment_reference || '',
      notes: payout.notes || '',
      payoutDate: payout.payout_date?.split('T')[0] || ''
    })
  }

  const handleEditPayment = async () => {
    if (!editModal) return
    
    try {
      await api.put('/payouts', {
        payoutId: editModal.payout_id,
        amount: parseFloat(editForm.amount),
        paymentMethod: editForm.method,
        paymentReference: editForm.reference,
        notes: editForm.notes,
        payoutDate: editForm.payoutDate
      })
      setEditModal(null)
      fetchData()
    } catch (error) {
      alert('Error updating payment: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleDeletePayment = async (payoutId) => {
    if (!confirm('Delete this payment record? This will restore the balance owed to the member.')) return
    
    try {
      await api.delete(`/payouts?payoutId=${payoutId}`)
      fetchData()
    } catch (error) {
      alert('Error deleting payment: ' + (error.response?.data?.error || error.message))
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
                          {balance > 0 ? (
                            <button
                              onClick={() => openPayModal(member)}
                              className="btn btn-primary text-xs py-1 px-3"
                            >
                              Pay
                            </button>
                          ) : parseFloat(member.total_earned || 0) > 0 ? (
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs">
                              ✓ Paid
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">No sales yet</span>
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
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Pool</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Sold</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Your %</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Total Profit</th>
                                        <th className="px-4 py-2 text-right font-medium text-slate-600">Your Payout</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {breakdown.map((row, idx) => {
                                        const totalPayout = parseFloat(row.total_payout_all) || 0
                                        const userPayout = parseFloat(row.user_payout) || 0
                                        const isLoss = totalPayout < 0
                                        const noSales = parseInt(row.total_sold) === 0
                                        return (
                                        <tr key={idx} className={`border-t ${isLoss ? 'bg-red-50' : ''}`}>
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
                                          <td className="px-4 py-2 text-right">
                                            {noSales ? (
                                              <span className="text-slate-400">—</span>
                                            ) : isLoss ? (
                                              <span className="text-red-600 font-medium">{formatCurrency(totalPayout)}</span>
                                            ) : (
                                              <span className="text-emerald-600">{formatCurrency(totalPayout)}</span>
                                            )}
                                          </td>
                                          <td className="px-4 py-2 text-right font-medium">
                                            {noSales ? (
                                              <span className="text-slate-400">—</span>
                                            ) : isLoss ? (
                                              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">Loss</span>
                                            ) : userPayout > 0 ? (
                                              <span className="text-emerald-600">{formatCurrency(userPayout)}</span>
                                            ) : (
                                              <span className="text-slate-400">$0.00</span>
                                            )}
                                          </td>
                                        </tr>
                                        )
                                      })}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t bg-slate-50">
                                        <td colSpan={6} className="px-4 py-2 text-right font-medium text-slate-600">
                                          Total Earned:
                                        </td>
                                        <td className="px-4 py-2 text-right font-bold text-emerald-600">
                                          {formatCurrency(breakdown.reduce((sum, r) => sum + Math.max(0, parseFloat(r.user_payout || 0)), 0))}
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
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paymentHistory.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-cell text-center py-8 text-slate-500">
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
                    <td className="table-cell text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(payout)}
                          className="p-1.5 text-slate-400 hover:text-knox-600 hover:bg-slate-100 rounded"
                          title="Edit payment"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePayment(payout.payout_id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                          title="Delete payment"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <p className="text-sm text-slate-500">
                Pay {payModal.full_name || payModal.username}
              </p>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Payment Type Selection */}
              <div>
                <label className="label">Payment Amount</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => updatePaymentType('total')}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      paymentForm.paymentType === 'total'
                        ? 'bg-knox-600 text-white border-knox-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-knox-400'
                    }`}
                  >
                    Total Balance
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePaymentType('byCoin')}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      paymentForm.paymentType === 'byCoin'
                        ? 'bg-knox-600 text-white border-knox-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-knox-400'
                    }`}
                  >
                    By Coin Type
                  </button>
                  <button
                    type="button"
                    onClick={() => updatePaymentType('custom')}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      paymentForm.paymentType === 'custom'
                        ? 'bg-knox-600 text-white border-knox-600'
                        : 'bg-white text-slate-700 border-slate-300 hover:border-knox-400'
                    }`}
                  >
                    Custom
                  </button>
                </div>
              </div>

              {/* Coin Type Selection (when byCoin is selected) */}
              {paymentForm.paymentType === 'byCoin' && memberBreakdowns[payModal.user_id] && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 border-b">
                    Select coin types to pay
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {memberBreakdowns[payModal.user_id]
                      .filter(row => parseFloat(row.user_payout) > 0)
                      .map((row, idx) => (
                        <label
                          key={idx}
                          className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer border-b last:border-b-0"
                        >
                          <input
                            type="checkbox"
                            checked={!!paymentForm.selectedCoins[row.coin_type_id]}
                            onChange={() => toggleCoinSelection(row.coin_type_id, row.user_payout)}
                            className="rounded border-slate-300 text-knox-600 focus:ring-knox-500"
                          />
                          <span className="flex-1 text-sm">{row.coin_type_name}</span>
                          <span className="text-sm font-medium text-emerald-600">
                            {formatCurrency(row.user_payout)}
                          </span>
                        </label>
                      ))}
                    {memberBreakdowns[payModal.user_id].filter(row => parseFloat(row.user_payout) > 0).length === 0 && (
                      <p className="px-3 py-4 text-sm text-slate-500 text-center">No positive payouts available</p>
                    )}
                  </div>
                </div>
              )}

              {/* Amount Display/Input */}
              <div>
                <label className="label">Amount to Pay</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    className="input pl-7"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                    readOnly={paymentForm.paymentType !== 'custom'}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Total balance owed: {formatCurrency(payModal.balance)}
                </p>
              </div>

              <div>
                <label className="label">Payment Method</label>
                <select
                  className="input"
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                >
                  <option value="ACH">ACH Transfer</option>
                  <option value="Wire">Wire Transfer</option>
                  <option value="Zelle">Zelle</option>
                  <option value="PayPal">PayPal</option>
                  <option value="Venmo">Venmo</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Reference # (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Transaction ID, confirmation number, etc."
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
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex gap-3">
              <button onClick={() => setPayModal(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button 
                onClick={handlePayment} 
                className="btn btn-primary flex-1"
                disabled={!paymentForm.amount || parseFloat(paymentForm.amount) <= 0}
              >
                Record Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Payment Modal */}
      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Payment</h2>
              <p className="text-sm text-slate-500">
                {editModal.full_name || editModal.username}
              </p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  className="input"
                  value={editForm.payoutDate}
                  onChange={(e) => setEditForm({ ...editForm, payoutDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    className="input pl-7"
                    value={editForm.amount}
                    onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Payment Method</label>
                <select
                  className="input"
                  value={editForm.method}
                  onChange={(e) => setEditForm({ ...editForm, method: e.target.value })}
                >
                  <option value="ACH">ACH Transfer</option>
                  <option value="Wire">Wire Transfer</option>
                  <option value="Zelle">Zelle</option>
                  <option value="PayPal">PayPal</option>
                  <option value="Venmo">Venmo</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Reference # (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Transaction ID, confirmation number, etc."
                  value={editForm.reference}
                  onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea
                  className="input"
                  rows={2}
                  placeholder="Any additional notes..."
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex gap-3">
              <button onClick={() => setEditModal(null)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button 
                onClick={handleEditPayment} 
                className="btn btn-primary flex-1"
                disabled={!editForm.amount || parseFloat(editForm.amount) <= 0}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
