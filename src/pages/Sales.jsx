import { useState, useEffect } from 'react'
import { Search, Download, ChevronLeft, ChevronRight, Trash2, TrendingUp, TrendingDown } from 'lucide-react'
import api from '../lib/api'

export default function Sales() {
  const [transactions, setTransactions] = useState([])
  const [coinTypes, setCoinTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)
  const [filters, setFilters] = useState({
    coinTypeId: '',
    startDate: '',
    endDate: ''
  })
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 25,
    offset: 0
  })

  useEffect(() => {
    fetchCoinTypes()
  }, [])

  useEffect(() => {
    fetchTransactions()
  }, [filters, pagination.offset])

  const fetchCoinTypes = async () => {
    try {
      const res = await api.get('/batches?action=coinTypes')
      setCoinTypes(res.data)
    } catch (error) {
      console.error('Error fetching coin types:', error)
    }
  }

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset
      })
      if (filters.coinTypeId) params.append('coinTypeId', filters.coinTypeId)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)

      const response = await api.get(`/transactions?${params}`)
      setTransactions(response.data.transactions)
      setSummary(response.data.summary)
      setPagination(prev => ({ ...prev, total: response.data.total }))
    } catch (error) {
      console.error('Error fetching transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (transactionId) => {
    if (!confirm('Delete this transaction?')) return
    try {
      await api.delete(`/transactions?transactionId=${transactionId}`)
      fetchTransactions()
    } catch (error) {
      alert('Error deleting transaction')
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, offset: 0 }))
  }

  const exportCSV = () => {
    const headers = ['Listing', 'Date Sold', 'Price Sold', 'Net eBay Fee', 'Advertising', 'Shipping', 'Total Payout', 'Coin Cost', 'Profit', 'Profit Share', 'Payout', 'Profit Margin', 'Type', 'Grade', 'Qty']
    const rows = transactions.map(tx => [
      tx.order_number || tx.listing_id,
      tx.sale_date?.split('T')[0],
      tx.sale_price,
      tx.ebay_fee,
      tx.advertising_fee,
      tx.shipping_cost,
      tx.total_payout,
      tx.coin_cost,
      tx.profit,
      tx.profit_share,
      tx.payout,
      ((tx.profit_margin || 0) * 100).toFixed(2) + '%',
      tx.coin_type_name,
      tx.grade,
      tx.quantity_sold
    ])
    
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1

  const formatCurrency = (val) => {
    const num = parseFloat(val) || 0
    return num < 0 ? `-$${Math.abs(num).toFixed(2)}` : `$${num.toFixed(2)}`
  }

  const formatPercent = (val) => {
    const num = (parseFloat(val) || 0) * 100
    return `${num.toFixed(1)}%`
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales Transactions</h1>
          <p className="text-slate-500 mt-1">View all imported eBay sales</p>
        </div>
        <button onClick={exportCSV} className="btn btn-secondary gap-2">
          <Download className="w-4 h-4" />
          Export CSV
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-sm text-slate-500">Total Revenue</p>
            <p className="text-2xl font-bold text-slate-900">${parseFloat(summary.total_revenue || 0).toLocaleString()}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">Total Profit</p>
            <p className={`text-2xl font-bold ${parseFloat(summary.total_profit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(summary.total_profit)}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">Profit Share (Admin)</p>
            <p className="text-2xl font-bold text-knox-600">${parseFloat(summary.total_profit_share || 0).toLocaleString()}</p>
          </div>
          <div className="card p-4">
            <p className="text-sm text-slate-500">Member Payouts</p>
            <p className="text-2xl font-bold text-slate-900">${parseFloat(summary.total_payout || 0).toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <select
            className="input w-auto"
            value={filters.coinTypeId}
            onChange={(e) => handleFilterChange('coinTypeId', e.target.value)}
          >
            <option value="">All Coin Types</option>
            {coinTypes.map(ct => (
              <option key={ct.coin_type_id} value={ct.coin_type_id}>{ct.name}</option>
            ))}
          </select>
          <input
            type="date"
            className="input w-auto"
            value={filters.startDate}
            onChange={(e) => handleFilterChange('startDate', e.target.value)}
          />
          <span className="text-slate-400">to</span>
          <input
            type="date"
            className="input w-auto"
            value={filters.endDate}
            onChange={(e) => handleFilterChange('endDate', e.target.value)}
          />
          {(filters.coinTypeId || filters.startDate || filters.endDate) && (
            <button 
              onClick={() => setFilters({ coinTypeId: '', startDate: '', endDate: '' })}
              className="text-sm text-knox-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Listing</th>
                <th className="table-header">Date</th>
                <th className="table-header text-right">Price</th>
                <th className="table-header text-right">eBay Fee</th>
                <th className="table-header text-right">Ads</th>
                <th className="table-header text-right">Ship</th>
                <th className="table-header text-right">Payout</th>
                <th className="table-header text-right">Cost</th>
                <th className="table-header text-right">Profit</th>
                <th className="table-header text-right">Share</th>
                <th className="table-header text-right">Member $</th>
                <th className="table-header text-right">Margin</th>
                <th className="table-header">Type</th>
                <th className="table-header">Grade</th>
                <th className="table-header text-center">Qty</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={16} className="table-cell text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600 mx-auto"></div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={16} className="table-cell text-center py-8 text-slate-500">
                    No transactions found. <a href="/upload" className="text-knox-600 hover:underline">Import eBay sales</a>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const profit = parseFloat(tx.profit) || 0
                  return (
                    <tr key={tx.transaction_id} className="hover:bg-slate-50">
                      <td className="table-cell font-mono text-xs">{tx.order_number || tx.listing_id || '-'}</td>
                      <td className="table-cell whitespace-nowrap">
                        {tx.sale_date?.split('T')[0]}
                      </td>
                      <td className="table-cell text-right">{formatCurrency(tx.sale_price)}</td>
                      <td className="table-cell text-right text-red-600">{formatCurrency(-Math.abs(tx.ebay_fee))}</td>
                      <td className="table-cell text-right text-red-600">{tx.advertising_fee > 0 ? formatCurrency(-tx.advertising_fee) : '-'}</td>
                      <td className="table-cell text-right">{formatCurrency(tx.shipping_cost)}</td>
                      <td className="table-cell text-right font-medium">{formatCurrency(tx.total_payout)}</td>
                      <td className="table-cell text-right">{formatCurrency(tx.coin_cost)}</td>
                      <td className={`table-cell text-right font-medium ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatCurrency(tx.profit)}
                      </td>
                      <td className="table-cell text-right">{formatCurrency(tx.profit_share)}</td>
                      <td className={`table-cell text-right font-medium ${parseFloat(tx.payout) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatCurrency(tx.payout)}
                      </td>
                      <td className={`table-cell text-right ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {formatPercent(tx.profit_margin)}
                      </td>
                      <td className="table-cell">
                        {tx.coin_type_name ? (
                          <span className="px-2 py-0.5 bg-knox-50 text-knox-700 rounded text-xs">
                            {tx.coin_type_name}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="table-cell">{tx.grade || '-'}</td>
                      <td className="table-cell text-center">{tx.quantity_sold}</td>
                      <td className="table-cell">
                        <button 
                          onClick={() => handleDelete(tx.transaction_id)}
                          className="p-1 text-slate-400 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.total > 0 && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              Showing {pagination.offset + 1} to {Math.min(pagination.offset + pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-secondary p-2"
                disabled={currentPage === 1}
                onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset - prev.limit }))}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-slate-600">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn btn-secondary p-2"
                disabled={currentPage === totalPages}
                onClick={() => setPagination(prev => ({ ...prev, offset: prev.offset + prev.limit }))}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
