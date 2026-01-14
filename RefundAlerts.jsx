import { useState, useEffect } from 'react'
import { AlertTriangle, CheckCircle, XCircle, ChevronDown, ChevronUp, ExternalLink, ArrowRight, X, Clock, AlertCircle } from 'lucide-react'
import api from '../lib/api'

const ALERT_TYPE_CONFIG = {
  paid_batch: {
    label: 'Paid Batch',
    color: 'red',
    priority: 'HIGH',
    icon: AlertTriangle,
    description: 'Refund on coin from a batch that has been paid out. Recovery needed from members.'
  },
  orphan: {
    label: 'Orphan',
    color: 'amber',
    priority: 'HIGH', 
    icon: AlertCircle,
    description: 'No original sale found for this refund. Manual review required.'
  },
  unpaid_batch: {
    label: 'Unpaid Batch',
    color: 'blue',
    priority: 'MEDIUM',
    icon: Clock,
    description: 'Refund on coin from a batch not yet paid. Batch inventory adjusted.'
  },
  unmapped: {
    label: 'Unmapped',
    color: 'slate',
    priority: 'LOW',
    icon: AlertCircle,
    description: 'Refund on sale that was never assigned to a batch. No batch impact.'
  }
}

export default function RefundAlerts() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')
  const [expandedId, setExpandedId] = useState(null)
  const [selectedAlert, setSelectedAlert] = useState(null)
  const [alertDetails, setAlertDetails] = useState(null)
  const [loadingDetails, setLoadingDetails] = useState(false)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    fetchAlerts()
  }, [filter])

  const fetchAlerts = async () => {
    try {
      setLoading(true)
      const res = await api.get(`/refunds?status=${filter}`)
      setAlerts(res.data)
    } catch (err) {
      console.error('Error fetching alerts:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAlertDetails = async (alertId) => {
    try {
      setLoadingDetails(true)
      const res = await api.get(`/refunds?action=details&alertId=${alertId}`)
      setAlertDetails(res.data)
    } catch (err) {
      console.error('Error fetching alert details:', err)
    } finally {
      setLoadingDetails(false)
    }
  }

  const openDetails = async (alert) => {
    setSelectedAlert(alert)
    await fetchAlertDetails(alert.alert_id)
  }

  const closeDetails = () => {
    setSelectedAlert(null)
    setAlertDetails(null)
  }

  const handleResolve = async (alertId, notes = '') => {
    try {
      setProcessing(true)
      await api.put(`/refunds?alertId=${alertId}`, { status: 'resolved', notes })
      fetchAlerts()
      closeDetails()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setProcessing(false)
    }
  }

  const handleDismiss = async (alertId, notes = '') => {
    try {
      setProcessing(true)
      await api.put(`/refunds?alertId=${alertId}`, { status: 'dismissed', notes })
      fetchAlerts()
      closeDetails()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setProcessing(false)
    }
  }

  const handleAssignSale = async (alertId, transactionId) => {
    try {
      setProcessing(true)
      await api.put(`/refunds?alertId=${alertId}`, { action: 'assignSale', transactionId })
      fetchAlerts()
      closeDetails()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setProcessing(false)
    }
  }

  const handleApplyAdjustments = async (alertId) => {
    if (!confirm('Apply all adjustments to member balances? This will deduct from their next payouts.')) return
    try {
      setProcessing(true)
      await api.post('/refunds', { action: 'applyAdjustments', alertId })
      fetchAlerts()
      closeDetails()
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    } finally {
      setProcessing(false)
    }
  }

  const handleWaiveAdjustment = async (adjustmentId) => {
    if (!confirm('Waive this adjustment? The member will not owe this amount.')) return
    try {
      await api.post('/refunds', { action: 'waiveAdjustment', adjustmentId })
      if (selectedAlert) {
        await fetchAlertDetails(selectedAlert.alert_id)
      }
    } catch (err) {
      alert('Error: ' + (err.response?.data?.error || err.message))
    }
  }

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0
    const formatted = Math.abs(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return num < 0 ? `-$${formatted}` : `$${formatted}`
  }

  const pendingCount = alerts.filter(a => a.status === 'pending').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Refund Alerts</h1>
          <p className="text-slate-500 mt-1">Review and resolve refund issues</p>
        </div>
        {pendingCount > 0 && filter !== 'pending' && (
          <button 
            onClick={() => setFilter('pending')}
            className="btn btn-primary"
          >
            {pendingCount} Pending Alert{pendingCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['pending', 'resolved', 'dismissed', 'all'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === f 
                ? 'bg-knox-600 text-white' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Alert List */}
      <div className="card">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading...</div>
        ) : alerts.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
            <p className="text-slate-600">No {filter !== 'all' ? filter : ''} refund alerts</p>
          </div>
        ) : (
          <div className="divide-y">
            {alerts.map(alert => {
              const config = ALERT_TYPE_CONFIG[alert.alert_type] || ALERT_TYPE_CONFIG.orphan
              const Icon = config.icon
              const isExpanded = expandedId === alert.alert_id

              return (
                <div key={alert.alert_id} className="p-4">
                  <div 
                    className="flex items-start gap-4 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : alert.alert_id)}
                  >
                    {/* Icon */}
                    <div className={`p-2 rounded-lg bg-${config.color}-100`}>
                      <Icon className={`w-5 h-5 text-${config.color}-600`} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium bg-${config.color}-100 text-${config.color}-700`}>
                          {config.label}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          config.priority === 'HIGH' ? 'bg-red-100 text-red-700' :
                          config.priority === 'MEDIUM' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {config.priority}
                        </span>
                        {alert.status !== 'pending' && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            alert.status === 'resolved' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {alert.status}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-900 mt-1 truncate">
                        {alert.refund_title || `Order ${alert.order_number}`}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {alert.coin_type_name && <span>{alert.coin_type_name} • </span>}
                        {alert.batch_name && <span>{alert.batch_name} • </span>}
                        <span className="text-red-600 font-medium">{formatCurrency(alert.refund_amount)}</span>
                        <span className="mx-1">•</span>
                        {new Date(alert.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); openDetails(alert); }}
                        className="btn btn-secondary text-sm px-3 py-1.5"
                      >
                        Details
                      </button>
                      {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                    </div>
                  </div>

                  {/* Expanded Info */}
                  {isExpanded && (
                    <div className="mt-4 ml-14 p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600">{config.description}</p>
                      {alert.suggestion && (
                        <p className="text-sm text-knox-600 mt-2">
                          <strong>Suggestion:</strong> {alert.suggestion}
                        </p>
                      )}
                      {alert.admin_notes && (
                        <p className="text-sm text-slate-500 mt-2">
                          <strong>Notes:</strong> {alert.admin_notes}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Details Modal */}
      {selectedAlert && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Refund Alert Details</h2>
                <p className="text-sm text-slate-500">Order: {selectedAlert.order_number}</p>
              </div>
              <button onClick={closeDetails} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loadingDetails ? (
                <div className="text-center py-8 text-slate-500">Loading details...</div>
              ) : alertDetails ? (
                <>
                  {/* Alert Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-slate-500 uppercase">Type</p>
                      <p className="text-sm font-medium">{ALERT_TYPE_CONFIG[alertDetails.alert.alert_type]?.label}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase">Refund Amount</p>
                      <p className="text-sm font-medium text-red-600">{formatCurrency(alertDetails.alert.refund_amount)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase">Coin Type</p>
                      <p className="text-sm font-medium">{alertDetails.alert.coin_type_name || 'Unknown'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase">Batch</p>
                      <p className="text-sm font-medium">{alertDetails.alert.batch_name || 'None'}</p>
                    </div>
                    {alertDetails.alert.original_sale_price && (
                      <>
                        <div>
                          <p className="text-xs text-slate-500 uppercase">Original Sale</p>
                          <p className="text-sm font-medium">{formatCurrency(alertDetails.alert.original_sale_price)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500 uppercase">Original Payout</p>
                          <p className="text-sm font-medium">{formatCurrency(alertDetails.alert.original_payout)}</p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Member Adjustments (for paid_batch) */}
                  {alertDetails.adjustments && alertDetails.adjustments.length > 0 && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Member Recovery</h3>
                      <div className="bg-red-50 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-red-100">
                            <tr>
                              <th className="text-left px-4 py-2">Member</th>
                              <th className="text-right px-4 py-2">Share %</th>
                              <th className="text-right px-4 py-2">Amount Owed</th>
                              <th className="text-center px-4 py-2">Status</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-red-100">
                            {alertDetails.adjustments.map(adj => (
                              <tr key={adj.adjustment_id}>
                                <td className="px-4 py-2">{adj.full_name || adj.username}</td>
                                <td className="px-4 py-2 text-right">{parseFloat(adj.share_percent).toFixed(1)}%</td>
                                <td className="px-4 py-2 text-right text-red-600 font-medium">{formatCurrency(adj.amount)}</td>
                                <td className="px-4 py-2 text-center">
                                  <span className={`px-2 py-0.5 rounded text-xs ${
                                    adj.status === 'applied' ? 'bg-emerald-100 text-emerald-700' :
                                    adj.status === 'waived' ? 'bg-slate-100 text-slate-600' :
                                    'bg-amber-100 text-amber-700'
                                  }`}>
                                    {adj.status}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right">
                                  {adj.status === 'pending' && (
                                    <button
                                      onClick={() => handleWaiveAdjustment(adj.adjustment_id)}
                                      className="text-xs text-slate-500 hover:text-slate-700"
                                    >
                                      Waive
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Unassigned Sales (for unpaid_batch) */}
                  {alertDetails.unassignedSales && alertDetails.unassignedSales.length > 0 && 
                   alertDetails.alert.status === 'pending' && alertDetails.alert.alert_type === 'unpaid_batch' && (
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 mb-3">Unassigned Sales Available</h3>
                      <p className="text-xs text-slate-500 mb-2">Assign one of these sales to the batch to replace the refunded coin:</p>
                      <div className="bg-slate-50 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-slate-100">
                            <tr>
                              <th className="text-left px-4 py-2">Order</th>
                              <th className="text-left px-4 py-2">Date</th>
                              <th className="text-right px-4 py-2">Payout</th>
                              <th className="px-4 py-2"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {alertDetails.unassignedSales.map(sale => (
                              <tr key={sale.transaction_id}>
                                <td className="px-4 py-2 font-mono text-xs">{sale.order_number}</td>
                                <td className="px-4 py-2">{sale.sale_date?.split('T')[0]}</td>
                                <td className="px-4 py-2 text-right">{formatCurrency(sale.total_payout)}</td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    onClick={() => handleAssignSale(alertDetails.alert.alert_id, sale.transaction_id)}
                                    disabled={processing}
                                    className="btn btn-primary text-xs px-2 py-1"
                                  >
                                    Assign <ArrowRight className="w-3 h-3 ml-1 inline" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Suggestion */}
                  {alertDetails.alert.suggestion && (
                    <div className="p-4 bg-knox-50 rounded-lg">
                      <p className="text-sm text-knox-700">
                        <strong>Suggestion:</strong> {alertDetails.alert.suggestion}
                      </p>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            {/* Footer Actions */}
            {alertDetails?.alert?.status === 'pending' && (
              <div className="px-6 py-4 border-t flex items-center justify-between bg-slate-50">
                <button
                  onClick={() => handleDismiss(alertDetails.alert.alert_id)}
                  disabled={processing}
                  className="btn btn-secondary"
                >
                  Dismiss
                </button>
                <div className="flex gap-2">
                  {alertDetails.alert.alert_type === 'paid_batch' && alertDetails.adjustments?.some(a => a.status === 'pending') && (
                    <button
                      onClick={() => handleApplyAdjustments(alertDetails.alert.alert_id)}
                      disabled={processing}
                      className="btn bg-red-600 text-white hover:bg-red-700"
                    >
                      Apply Adjustments
                    </button>
                  )}
                  <button
                    onClick={() => handleResolve(alertDetails.alert.alert_id)}
                    disabled={processing}
                    className="btn btn-primary"
                  >
                    Mark Resolved
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
