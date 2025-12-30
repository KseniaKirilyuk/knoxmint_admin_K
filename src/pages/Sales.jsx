import React, { useState, useEffect, useRef } from 'react'
import { Search, Download, ChevronLeft, ChevronRight, ChevronDown, Trash2, TrendingUp, TrendingDown, AlertTriangle, X, Wand2, Edit2, Plus } from 'lucide-react'
import api from '../lib/api'

export default function Sales() {
  const [transactions, setTransactions] = useState([])
  const [coinTypes, setCoinTypes] = useState([])
  const [batches, setBatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState(null)
  const [unmappedCount, setUnmappedCount] = useState(0)
  const [expandedRows, setExpandedRows] = useState({})
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
  
  // Coin type search state
  const [coinSearch, setCoinSearch] = useState('')
  const [showCoinDropdown, setShowCoinDropdown] = useState(false)
  const [selectedCoinName, setSelectedCoinName] = useState('All Coin Types')
  const coinSearchRef = useRef(null)
  
  // Bulk mapping state
  const [showMappingModal, setShowMappingModal] = useState(false)
  const [unmappedTitles, setUnmappedTitles] = useState([])
  const [titleMappings, setTitleMappings] = useState({})
  const [applyingMappings, setApplyingMappings] = useState(false)

  // Edit state
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingTx, setEditingTx] = useState(null)
  const [editForm, setEditForm] = useState({})

  // Create test sale state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState({
    batchId: '',
    coinTypeId: '',
    itemTitle: 'Test Sale',
    saleDate: new Date().toISOString().split('T')[0],
    salePrice: '',
    ebayFee: '',
    advertisingFee: '',
    shippingCost: '',
    quantitySold: 1,
    grade: ''
  })

  useEffect(() => {
    fetchCoinTypes()
    fetchBatches()
  }, [])

  useEffect(() => {
    fetchTransactions()
  }, [filters, pagination.offset])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (coinSearchRef.current && !coinSearchRef.current.contains(e.target)) {
        setShowCoinDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const fetchCoinTypes = async () => {
    try {
      const res = await api.get('/batches?action=coinTypes')
      setCoinTypes(res.data)
    } catch (error) {
      console.error('Error fetching coin types:', error)
    }
  }

  const fetchBatches = async () => {
    try {
      const res = await api.get('/batches')
      setBatches(res.data)
    } catch (error) {
      console.error('Error fetching batches:', error)
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
      setUnmappedCount(response.data.unmappedCount || 0)
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

  const toggleRow = (transactionId) => {
    setExpandedRows(prev => ({
      ...prev,
      [transactionId]: !prev[transactionId]
    }))
  }

  const handleCreateSale = async (e) => {
    e.preventDefault()
    try {
      const response = await api.post('/transactions', createForm)
      setShowCreateModal(false)
      setCreateForm({
        batchId: '',
        coinTypeId: '',
        itemTitle: 'Test Sale',
        saleDate: new Date().toISOString().split('T')[0],
        salePrice: '',
        ebayFee: '',
        advertisingFee: '',
        shippingCost: '',
        quantitySold: 1,
        grade: ''
      })
      fetchTransactions()
      
      const calc = response.data.calculated
      if (calc) {
        alert(`Sale created!\n\nCoin Cost: $${calc.coinCost.toFixed(2)}\nProfit: $${calc.profit.toFixed(2)}\nProfit Share (33%): $${calc.profitShare.toFixed(2)}\nMember Payout: $${calc.memberPayout.toFixed(2)}`)
      } else {
        alert('Sale created!')
      }
    } catch (error) {
      alert('Error creating sale: ' + (error.response?.data?.error || error.message))
    }
  }

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }))
    setPagination(prev => ({ ...prev, offset: 0 }))
  }

  const selectCoinType = (coinTypeId, displayName) => {
    setFilters(prev => ({ ...prev, coinTypeId }))
    setPagination(prev => ({ ...prev, offset: 0 }))
    setSelectedCoinName(displayName)
    setCoinSearch('')
    setShowCoinDropdown(false)
  }

  const filteredCoinTypes = coinTypes.filter(ct => {
    const search = coinSearch.toLowerCase()
    return ct.name.toLowerCase().includes(search) ||
           ct.short_code?.toLowerCase().includes(search) ||
           ct.catalog_id?.toLowerCase().includes(search)
  })

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

  // Bulk mapping functions
  const openMappingModal = async () => {
    try {
      const res = await api.get('/transactions?action=unmappedTitles')
      setUnmappedTitles(res.data)
      
      // Auto-suggest mappings based on keywords
      const suggestions = {}
      res.data.forEach(item => {
        const titleLower = item.item_title?.toLowerCase() || ''
        for (const ct of coinTypes) {
          const ctNameLower = ct.name.toLowerCase()
          // Check if coin type name or keywords match
          if (titleLower.includes(ctNameLower)) {
            suggestions[item.item_title] = ct.coin_type_id
            break
          }
          if (ct.keywords) {
            for (const kw of ct.keywords) {
              if (titleLower.includes(kw.toLowerCase())) {
                suggestions[item.item_title] = ct.coin_type_id
                break
              }
            }
          }
        }
      })
      setTitleMappings(suggestions)
      setShowMappingModal(true)
    } catch (error) {
      console.error('Error fetching unmapped titles:', error)
      alert('Error loading unmapped sales')
    }
  }

  const applyMappings = async () => {
    const mappingsToApply = Object.entries(titleMappings).filter(([_, v]) => v)
    if (mappingsToApply.length === 0) {
      alert('Please select at least one mapping')
      return
    }
    
    setApplyingMappings(true)
    try {
      const res = await api.put('/transactions', { mappings: titleMappings })
      alert(`Successfully updated ${res.data.updated} sales!`)
      setShowMappingModal(false)
      setTitleMappings({})
      fetchTransactions()
    } catch (error) {
      console.error('Error applying mappings:', error)
      alert('Error applying mappings')
    } finally {
      setApplyingMappings(false)
    }
  }

  // Edit functions
  const openEditModal = (tx) => {
    setEditingTx(tx)
    setEditForm({
      coinTypeId: tx.coin_type_id || '',
      saleDate: tx.sale_date ? tx.sale_date.split('T')[0] : '',
      salePrice: parseFloat(tx.sale_price || 0).toFixed(2),
      ebayFee: parseFloat(tx.ebay_fee || 0).toFixed(2),
      advertisingFee: parseFloat(tx.advertising_fee || 0).toFixed(2),
      shippingCost: parseFloat(tx.shipping_cost || 0).toFixed(2),
      coinCost: parseFloat(tx.coin_cost || 0).toFixed(2),
      grade: tx.grade || '',
      quantitySold: tx.quantity_sold || 1
    })
    setShowEditModal(true)
  }

  const handleSaveEdit = async () => {
    try {
      await api.put(`/transactions?transactionId=${editingTx.transaction_id}`, {
        coinTypeId: editForm.coinTypeId || null,
        saleDate: editForm.saleDate,
        salePrice: parseFloat(editForm.salePrice) || 0,
        ebayFee: parseFloat(editForm.ebayFee) || 0,
        advertisingFee: parseFloat(editForm.advertisingFee) || 0,
        shippingCost: parseFloat(editForm.shippingCost) || 0,
        coinCost: parseFloat(editForm.coinCost) || 0,
        grade: editForm.grade,
        quantitySold: parseInt(editForm.quantitySold) || 1
      })
      setShowEditModal(false)
      setEditingTx(null)
      fetchTransactions()
    } catch (error) {
      console.error('Error saving transaction:', error)
      alert('Error saving transaction: ' + (error.response?.data?.error || error.message))
    }
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
        <div className="flex gap-2">
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary gap-2">
            <Plus className="w-4 h-4" />
            Create Test Sale
          </button>
          <button onClick={exportCSV} className="btn btn-secondary gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="space-y-2">
          {filters.coinTypeId && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Showing totals for:</span>
              <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                filters.coinTypeId === 'unmapped' 
                  ? 'bg-amber-100 text-amber-700' 
                  : 'bg-knox-100 text-knox-700'
              }`}>
                {filters.coinTypeId === 'unmapped' 
                  ? '⚠️ Unmapped Sales' 
                  : coinTypes.find(ct => ct.coin_type_id === parseInt(filters.coinTypeId))?.name || 'Selected Coin'}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
            <div className="card p-4">
              <p className="text-sm text-slate-500">Gross Revenue</p>
              <p className="text-2xl font-bold text-slate-900">${parseFloat(summary.total_revenue || 0).toLocaleString()}</p>
              {parseFloat(summary.total_shipping) > 0 && (
                <p className="text-xs text-amber-600 mt-1">-${parseFloat(summary.total_shipping).toFixed(2)} shipping</p>
              )}
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-500">Total Cost</p>
              <p className="text-2xl font-bold text-slate-700">${parseFloat(summary.total_cost || 0).toLocaleString()}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-500">Net Profit</p>
              <p className={`text-2xl font-bold ${parseFloat(summary.total_profit) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(summary.total_profit)}
              </p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-500">Your Share (33%)</p>
              <p className="text-2xl font-bold text-knox-600">${parseFloat(summary.total_profit_share || 0).toLocaleString()}</p>
            </div>
            <div className="card p-4">
              <p className="text-sm text-slate-500">Member Payouts</p>
              <p className="text-2xl font-bold text-slate-900">${parseFloat(summary.total_payout || 0).toLocaleString()}</p>
            </div>
            {parseInt(summary.refund_count) > 0 && (
              <div className="card p-4 bg-red-50">
                <p className="text-sm text-red-600">Refunds ({summary.refund_count})</p>
                <p className="text-2xl font-bold text-red-700">{formatCurrency(summary.refund_total)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Unmapped Warning */}
      {unmappedCount > 0 && filters.coinTypeId !== 'unmapped' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-amber-800 font-medium">
              {unmappedCount} sale{unmappedCount > 1 ? 's' : ''} not mapped to any coin type
            </p>
            <p className="text-amber-600 text-sm">These won't be included in member payout calculations.</p>
          </div>
          <button 
            onClick={openMappingModal}
            className="btn btn-primary gap-2"
          >
            <Wand2 className="w-4 h-4" />
            Map Sales
          </button>
          <button 
            onClick={() => handleFilterChange('coinTypeId', 'unmapped')}
            className="btn btn-secondary text-amber-700 border-amber-300 hover:bg-amber-100"
          >
            View
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Searchable Coin Type Filter */}
          <div className="relative" ref={coinSearchRef}>
            <div 
              className="input w-64 flex items-center gap-2 cursor-pointer"
              onClick={() => setShowCoinDropdown(true)}
            >
              <Search className="w-4 h-4 text-slate-400" />
              {showCoinDropdown ? (
                <input
                  type="text"
                  className="flex-1 outline-none bg-transparent"
                  placeholder="Search coin types..."
                  value={coinSearch}
                  onChange={(e) => setCoinSearch(e.target.value)}
                  autoFocus
                />
              ) : (
                <span className={filters.coinTypeId === 'unmapped' ? 'text-amber-600' : 'text-slate-700'}>
                  {selectedCoinName}
                </span>
              )}
              {filters.coinTypeId && (
                <button 
                  onClick={(e) => {
                    e.stopPropagation()
                    selectCoinType('', 'All Coin Types')
                  }}
                  className="p-0.5 hover:bg-slate-200 rounded"
                >
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              )}
            </div>
            
            {showCoinDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 max-h-80 overflow-y-auto">
                <button
                  onClick={() => selectCoinType('', 'All Coin Types')}
                  className={`w-full px-3 py-2 text-left hover:bg-slate-50 ${!filters.coinTypeId ? 'bg-knox-50 text-knox-700' : ''}`}
                >
                  All Coin Types
                </button>
                <button
                  onClick={() => selectCoinType('unmapped', `⚠️ Unmapped Sales (${unmappedCount})`)}
                  className={`w-full px-3 py-2 text-left hover:bg-amber-50 text-amber-600 ${filters.coinTypeId === 'unmapped' ? 'bg-amber-50' : ''}`}
                >
                  ⚠️ Unmapped Sales {unmappedCount > 0 ? `(${unmappedCount})` : ''}
                </button>
                <div className="border-t border-slate-100"></div>
                {filteredCoinTypes.length === 0 ? (
                  <div className="px-3 py-2 text-slate-500 text-sm">No matching coins</div>
                ) : (
                  filteredCoinTypes.map(ct => (
                    <button
                      key={ct.coin_type_id}
                      onClick={() => selectCoinType(ct.coin_type_id, ct.name)}
                      className={`w-full px-3 py-2 text-left hover:bg-slate-50 flex items-center justify-between ${filters.coinTypeId == ct.coin_type_id ? 'bg-knox-50 text-knox-700' : ''}`}
                    >
                      <span>{ct.name}</span>
                      {ct.short_code && (
                        <span className="text-xs text-slate-400 font-mono">{ct.short_code}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          
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
              onClick={() => {
                setFilters({ coinTypeId: '', startDate: '', endDate: '' })
                setSelectedCoinName('All Coin Types')
              }}
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
              <tr className="bg-slate-50 border-b">
                <th className="table-header w-8"></th>
                <th className="table-header">Listing</th>
                <th className="table-header">Title</th>
                <th className="table-header">Date</th>
                <th className="table-header text-right">Price</th>
                <th className="table-header text-right">eBay Fee</th>
                <th className="table-header text-right">Ads</th>
                <th className="table-header text-right">Ship</th>
                <th className="table-header text-right">eBay Payout</th>
                <th className="table-header">Batch</th>
                <th className="table-header text-center">Qty</th>
                <th className="table-header text-right">Member Payout</th>
                <th className="table-header"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={13} className="table-cell text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600 mx-auto"></div>
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={13} className="table-cell text-center py-8 text-slate-500">
                    No transactions found. <a href="/upload" className="text-knox-600 hover:underline">Import eBay sales</a>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const isExpanded = expandedRows[tx.transaction_id]
                  const isRefund = tx.is_refund
                  const isRefunded = tx.is_refunded
                  const qty = parseInt(tx.quantity_sold) || 1
                  const ebayPayout = parseFloat(tx.total_payout) || 0
                  const unitCoinCost = parseFloat(tx.unit_coin_cost) || 0
                  const unitGradingCost = parseFloat(tx.unit_grading_cost) || 0
                  const totalCoinCost = unitCoinCost * qty
                  const totalGradingCost = unitGradingCost * qty
                  const profit = ebayPayout - totalGradingCost - totalCoinCost
                  const adminShare = Math.max(0.33 * profit, 8 * qty)
                  const memberPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare)
                  const isUngraded = tx.is_ungraded || tx.coin_type_name?.includes('(Ungraded)')
                  
                  return (
                    <React.Fragment key={tx.transaction_id}>
                      {/* Main Row */}
                      <tr 
                        className={`hover:bg-slate-50 cursor-pointer ${isRefund ? 'bg-red-50' : isRefunded ? 'bg-orange-50' : ''} ${isExpanded ? 'bg-knox-50/50' : ''}`}
                        onClick={() => toggleRow(tx.transaction_id)}
                      >
                        <td className="table-cell">
                          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </td>
                        <td className="table-cell font-mono text-xs">
                          {tx.order_number || tx.listing_id || '-'}
                          {isRefund && <span className="ml-1 px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-medium">REFUND</span>}
                          {isRefunded && <span className="ml-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-medium">REFUNDED</span>}
                        </td>
                        <td className="table-cell max-w-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-slate-700" title={tx.item_title}>
                              {tx.coin_type_name || tx.item_title || '-'}
                            </span>
                            {tx.coin_type_name && (
                              isUngraded ? (
                                <span className="flex-shrink-0 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-medium">UG</span>
                              ) : (
                                <span className="flex-shrink-0 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-medium">GR</span>
                              )
                            )}
                          </div>
                        </td>
                        <td className="table-cell whitespace-nowrap">
                          {tx.sale_date?.split('T')[0]}
                        </td>
                        <td className="table-cell text-right">{formatCurrency(tx.sale_price)}</td>
                        <td className="table-cell text-right text-red-600">{formatCurrency(-Math.abs(tx.ebay_fee))}</td>
                        <td className="table-cell text-right text-red-600">{tx.advertising_fee > 0 ? formatCurrency(-tx.advertising_fee) : '-'}</td>
                        <td className="table-cell text-right text-amber-600">{tx.shipping_cost > 0 ? formatCurrency(-tx.shipping_cost) : '-'}</td>
                        <td className="table-cell text-right font-medium">{formatCurrency(ebayPayout)}</td>
                        <td className="table-cell">
                          {tx.batch_name ? (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                              {tx.batch_name}
                            </span>
                          ) : (
                            <span className="text-amber-600 text-xs">Not mapped</span>
                          )}
                        </td>
                        <td className="table-cell text-center">{qty}</td>
                        <td className={`table-cell text-right font-medium ${memberPayout > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                          {formatCurrency(memberPayout)}
                        </td>
                        <td className="table-cell" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => openEditModal(tx)}
                              className="p-1 text-slate-400 hover:text-knox-600"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => handleDelete(tx.transaction_id)}
                              className="p-1 text-slate-400 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      
                      {/* Expanded Detail Row */}
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={13} className="px-6 py-4 border-b">
                            <div className="max-w-lg mx-auto bg-white rounded-lg border shadow-sm p-4">
                              <div className="flex items-center justify-between mb-3 pb-2 border-b">
                                <span className="text-sm font-semibold text-slate-800">Calculation Breakdown</span>
                                {tx.batch_name && (
                                  <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded">
                                    {tx.batch_name}
                                  </span>
                                )}
                              </div>
                              
                              {/* Costs Table */}
                              <table className="w-full text-sm mb-3">
                                <thead>
                                  <tr className="text-xs text-slate-500">
                                    <th className="text-left pb-1"></th>
                                    <th className="text-right pb-1">Per Coin</th>
                                    <th className="text-right pb-1">Qty</th>
                                    <th className="text-right pb-1">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  <tr>
                                    <td className="py-1 text-slate-600">Coin Cost</td>
                                    <td className="py-1 text-right">{formatCurrency(unitCoinCost)}</td>
                                    <td className="py-1 text-right text-slate-400">×{qty}</td>
                                    <td className="py-1 text-right font-medium">{formatCurrency(totalCoinCost)}</td>
                                  </tr>
                                  <tr>
                                    <td className="py-1 text-slate-600">Grading Cost</td>
                                    <td className="py-1 text-right">{formatCurrency(unitGradingCost)}</td>
                                    <td className="py-1 text-right text-slate-400">×{qty}</td>
                                    <td className="py-1 text-right font-medium">{formatCurrency(totalGradingCost)}</td>
                                  </tr>
                                </tbody>
                              </table>
                              
                              {/* Payout Calculation */}
                              <div className="bg-slate-50 rounded-lg p-3 space-y-2">
                                <div className="flex justify-between text-sm">
                                  <span className="text-slate-600">eBay Payout</span>
                                  <span className="font-medium">{formatCurrency(ebayPayout)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-slate-600">− Grading Cost</span>
                                  <span className="text-red-600">−{formatCurrency(totalGradingCost)}</span>
                                </div>
                                <div className="flex justify-between text-sm">
                                  <span className="text-slate-600">− Admin Share (33%)</span>
                                  <span className="text-red-600">−{formatCurrency(adminShare)}</span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  max(33% × {formatCurrency(profit)} profit, {formatCurrency(8 * qty)} min)
                                </div>
                                
                                <div className="border-t pt-2 mt-2 flex justify-between text-sm font-semibold">
                                  <span className="text-slate-900">Member Payout</span>
                                  <span className={`text-lg ${memberPayout > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                                    {formatCurrency(memberPayout)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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

      {/* Bulk Mapping Modal */}
      {showMappingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Map Unmapped Sales</h2>
                <p className="text-sm text-slate-500 mt-1">
                  {unmappedTitles.length} unique title{unmappedTitles.length !== 1 ? 's' : ''} to map
                </p>
              </div>
              <button 
                onClick={() => setShowMappingModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {unmappedTitles.length === 0 ? (
                <p className="text-slate-500 text-center py-8">No unmapped sales found!</p>
              ) : (
                <div className="space-y-4">
                  {unmappedTitles.map((item, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate" title={item.item_title}>
                            {item.item_title}
                          </p>
                          <p className="text-xs text-slate-500 mt-1">
                            {item.count} sale{item.count > 1 ? 's' : ''} • ${parseFloat(item.total_revenue).toLocaleString()} revenue
                          </p>
                        </div>
                        <div className="flex-shrink-0 w-64">
                          <select
                            className="input w-full text-sm"
                            value={titleMappings[item.item_title] || ''}
                            onChange={(e) => setTitleMappings(prev => ({
                              ...prev,
                              [item.item_title]: e.target.value ? parseInt(e.target.value) : null
                            }))}
                          >
                            <option value="">— Select coin type —</option>
                            {coinTypes.map(ct => (
                              <option key={ct.coin_type_id} value={ct.coin_type_id}>
                                {ct.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between">
              <p className="text-sm text-slate-500">
                {Object.values(titleMappings).filter(Boolean).length} of {unmappedTitles.length} mapped
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowMappingModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  onClick={applyMappings}
                  disabled={applyingMappings || Object.values(titleMappings).filter(Boolean).length === 0}
                  className="btn btn-primary gap-2"
                >
                  {applyingMappings ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                      Applying...
                    </>
                  ) : (
                    <>
                      <Wand2 className="w-4 h-4" />
                      Apply Mappings
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {showEditModal && editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <div>
                <h2 className="text-lg font-semibold">Edit Transaction</h2>
                <p className="text-sm text-slate-500 font-mono">{editingTx.listing_id}</p>
              </div>
              <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Coin Type</label>
                <select
                  className="input"
                  value={editForm.coinTypeId}
                  onChange={(e) => setEditForm({ ...editForm, coinTypeId: e.target.value })}
                >
                  <option value="">-- Not Mapped --</option>
                  {coinTypes.map(ct => (
                    <option key={ct.coin_type_id} value={ct.coin_type_id}>
                      {ct.name} {ct.short_code ? `(${ct.short_code})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Sale Date</label>
                  <input
                    type="date"
                    className="input"
                    value={editForm.saleDate}
                    onChange={(e) => setEditForm({ ...editForm, saleDate: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Grade</label>
                  <input
                    type="text"
                    className="input"
                    value={editForm.grade}
                    onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })}
                    placeholder="e.g., MS70"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Sale Price ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={editForm.salePrice}
                    onChange={(e) => setEditForm({ ...editForm, salePrice: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Coin Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={editForm.coinCost}
                    onChange={(e) => setEditForm({ ...editForm, coinCost: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">eBay Fee ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={editForm.ebayFee}
                    onChange={(e) => setEditForm({ ...editForm, ebayFee: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Ads Fee ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={editForm.advertisingFee}
                    onChange={(e) => setEditForm({ ...editForm, advertisingFee: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Shipping ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={editForm.shippingCost}
                    onChange={(e) => setEditForm({ ...editForm, shippingCost: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Quantity Sold</label>
                <input
                  type="number"
                  min="1"
                  className="input w-24"
                  value={editForm.quantitySold}
                  onChange={(e) => setEditForm({ ...editForm, quantitySold: e.target.value })}
                />
              </div>

              {/* Preview calculated values */}
              <div className="bg-slate-50 rounded-lg p-4 space-y-2">
                <h4 className="font-medium text-slate-700 text-sm">Calculated Values</h4>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-slate-500">Payout</p>
                    <p className="font-medium">
                      ${(parseFloat(editForm.salePrice || 0) - parseFloat(editForm.ebayFee || 0) - parseFloat(editForm.advertisingFee || 0) - parseFloat(editForm.shippingCost || 0)).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Profit</p>
                    <p className={`font-medium ${
                      (parseFloat(editForm.salePrice || 0) - parseFloat(editForm.ebayFee || 0) - parseFloat(editForm.advertisingFee || 0) - parseFloat(editForm.shippingCost || 0) - parseFloat(editForm.coinCost || 0)) >= 0 
                        ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                      ${(parseFloat(editForm.salePrice || 0) - parseFloat(editForm.ebayFee || 0) - parseFloat(editForm.advertisingFee || 0) - parseFloat(editForm.shippingCost || 0) - parseFloat(editForm.coinCost || 0)).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-slate-500">Margin</p>
                    <p className="font-medium">
                      {editForm.salePrice > 0 
                        ? ((parseFloat(editForm.salePrice || 0) - parseFloat(editForm.ebayFee || 0) - parseFloat(editForm.advertisingFee || 0) - parseFloat(editForm.shippingCost || 0) - parseFloat(editForm.coinCost || 0)) / parseFloat(editForm.salePrice) * 100).toFixed(1) + '%'
                        : '0%'
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex gap-3">
              <button onClick={() => setShowEditModal(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={handleSaveEdit} className="btn btn-primary flex-1">
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Test Sale Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Create Test Sale</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSale} className="p-6 space-y-4">
              <div>
                <label className="label">Batch *</label>
                <select
                  className="input"
                  value={createForm.batchId}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, batchId: e.target.value }))}
                  required
                >
                  <option value="">Select batch...</option>
                  {batches.map(b => (
                    <option key={b.batch_id} value={b.batch_id}>{b.batch_name}</option>
                  ))}
                </select>
              </div>
              
              <div>
                <label className="label">Coin Type *</label>
                <select
                  className="input"
                  value={createForm.coinTypeId}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, coinTypeId: e.target.value }))}
                  required
                >
                  <option value="">Select coin type...</option>
                  {coinTypes.map(ct => (
                    <option key={ct.coin_type_id} value={ct.coin_type_id}>
                      {ct.name} {ct.is_ungraded ? '(UG)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Item Title</label>
                <input
                  type="text"
                  className="input"
                  value={createForm.itemTitle}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, itemTitle: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Sale Date *</label>
                  <input
                    type="date"
                    className="input"
                    value={createForm.saleDate}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, saleDate: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="label">Sale Price *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="200.00"
                    value={createForm.salePrice}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, salePrice: e.target.value }))}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">eBay Fee</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="20.00"
                    value={createForm.ebayFee}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, ebayFee: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Ad Fee</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="5.00"
                    value={createForm.advertisingFee}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, advertisingFee: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Shipping</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder="10.00"
                    value={createForm.shippingCost}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, shippingCost: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Quantity</label>
                  <input
                    type="number"
                    className="input"
                    value={createForm.quantitySold}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, quantitySold: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Grade (optional)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="MS70, PR70, etc."
                    value={createForm.grade}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, grade: e.target.value }))}
                  />
                </div>
              </div>

              <div className="bg-slate-100 rounded-lg p-3 text-sm">
                <p className="font-medium text-slate-700">Calculated:</p>
                <p className="text-slate-600">
                  Total Fees: ${((parseFloat(createForm.ebayFee) || 0) + (parseFloat(createForm.advertisingFee) || 0) + (parseFloat(createForm.shippingCost) || 0)).toFixed(2)}
                </p>
                <p className="text-slate-600">
                  Net Payout: ${((parseFloat(createForm.salePrice) || 0) - (parseFloat(createForm.ebayFee) || 0) - (parseFloat(createForm.advertisingFee) || 0) - (parseFloat(createForm.shippingCost) || 0)).toFixed(2)}
                </p>
                <p className="text-slate-500 text-xs mt-1">
                  Note: Coin cost is pulled from "Edit Prices" in the batch. Make sure costs are set first!
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  Create Sale
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
