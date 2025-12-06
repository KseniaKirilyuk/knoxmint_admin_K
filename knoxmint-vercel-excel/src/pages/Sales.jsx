import { useState, useEffect } from 'react'
import { Search, Filter, Download, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../lib/api'

export default function Sales() {
  const [transactions, setTransactions] = useState([])
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    groupId: '',
    startDate: '',
    endDate: '',
    search: ''
  })
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 25,
    offset: 0
  })

  useEffect(() => {
    fetchGroups()
  }, [])

  useEffect(() => {
    fetchTransactions()
  }, [filters, pagination.offset])

  const fetchGroups = async () => {
    try {
      const response = await api.get('/groups')
      setGroups(response.data)
    } catch (error) {
      console.error('Error fetching groups:', error)
    }
  }

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        limit: pagination.limit,
        offset: pagination.offset
      })
      if (filters.groupId) params.append('groupId', filters.groupId)
      if (filters.startDate) params.append('startDate', filters.startDate)
      if (filters.endDate) params.append('endDate', filters.endDate)

      const response = await api.get(`/transactions?${params}`)
      setTransactions(response.data.transactions)
      setPagination(prev => ({ ...prev, total: response.data.total }))
    } catch (error) {
      console.error('Error fetching transactions:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, offset: 0 }))
  }

  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sales Transactions</h1>
          <p className="text-slate-500 mt-1">View and manage all sales transactions</p>
        </div>
        <button className="btn btn-secondary gap-2">
          <Download className="w-4 h-4" />
          Export
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search listings..."
                className="input pl-10"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
              />
            </div>
          </div>
          <select
            className="input w-auto"
            value={filters.groupId}
            onChange={(e) => handleFilterChange('groupId', e.target.value)}
          >
            <option value="">All Groups</option>
            {groups.map(g => (
              <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
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
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">Listing ID</th>
                <th className="table-header">Group</th>
                <th className="table-header">Coin</th>
                <th className="table-header text-right">Sale Price</th>
                <th className="table-header text-right">Fees</th>
                <th className="table-header text-right">Cost</th>
                <th className="table-header text-right">Profit</th>
                <th className="table-header text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="table-cell text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600 mx-auto"></div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="table-cell text-center py-8 text-slate-500">
                    No transactions found
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => (
                  <tr key={tx.transaction_id} className="hover:bg-slate-50">
                    <td className="table-cell whitespace-nowrap">
                      {new Date(tx.sale_date).toLocaleDateString()}
                    </td>
                    <td className="table-cell font-mono text-xs">{tx.listing_id}</td>
                    <td className="table-cell">
                      <span className="px-2 py-1 bg-knox-50 text-knox-700 rounded text-xs font-medium">
                        {tx.group_name}
                      </span>
                    </td>
                    <td className="table-cell">
                      {tx.design && (
                        <span className="text-sm">
                          {tx.design} {tx.grade && `MS${tx.grade}`}
                        </span>
                      )}
                    </td>
                    <td className="table-cell text-right">${parseFloat(tx.sale_price).toFixed(2)}</td>
                    <td className="table-cell text-right text-slate-500">
                      ${(parseFloat(tx.ebay_fee || 0) + parseFloat(tx.advertising_fee || 0)).toFixed(2)}
                    </td>
                    <td className="table-cell text-right">${parseFloat(tx.coin_cost).toFixed(2)}</td>
                    <td className={`table-cell text-right font-medium ${parseFloat(tx.profit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      ${parseFloat(tx.profit).toFixed(2)}
                    </td>
                    <td className="table-cell text-right">${parseFloat(tx.profit_share).toFixed(2)}</td>
                  </tr>
                ))
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
