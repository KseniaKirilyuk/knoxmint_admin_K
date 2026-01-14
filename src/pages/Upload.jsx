import { useState, useEffect, useCallback } from 'react'
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle, AlertCircle, X, Edit2, ChevronDown, ChevronUp } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../lib/api'

export default function Upload() {
  const [file, setFile] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [coinTypes, setCoinTypes] = useState([])
  const [titleMappings, setTitleMappings] = useState({}) // { title: { action: 'map'|'create'|'skip', coinTypeId?, newName?, cost? } }
  const [includedTitles, setIncludedTitles] = useState({}) // { title: true/false }
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [expandedTitles, setExpandedTitles] = useState({})

  useEffect(() => {
    fetchCoinTypes()
  }, [])

  const fetchCoinTypes = async () => {
    try {
      const res = await api.get('/batches?action=coinTypes')
      setCoinTypes(res.data)
    } catch (err) {
      console.error('Error fetching coin types:', err)
    }
  }

  const handleDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0])
  }, [])

  const extractGrade = (title) => {
    if (!title) return null
    const match = title.match(/(MS|PR)\d{2}/i)
    return match ? match[0].toUpperCase() : null
  }

  // Check if item title looks like a coin
  const looksLikeCoin = (title) => {
    if (!title) return false
    const titleLower = title.toLowerCase()
    const coinKeywords = [
      'morgan', 'peace', 'eagle', 'sacagawea', 'liberty', 'laser', 'army', 'navy',
      'dollar', 'coin', 'silver', 'gold', 'pcgs', 'ngc', 'ms69', 'ms70', 'pr69', 'pr70',
      'proof', 'mint', 'commemorative', 'bullion', 'privy', 'first strike', 'first day'
    ]
    return coinKeywords.some(kw => titleLower.includes(kw))
  }

  // Generate a suggested short name from title
  const suggestName = (title) => {
    if (!title || title === '--') return 'Unknown'
    
    // Extract key parts: year, mint mark, coin type, grade
    const yearMatch = title.match(/\b(20\d{2}|19\d{2})\b/)
    const mintMatch = title.match(/\b([WOPSDC]{1,2})\b/)
    const gradeMatch = title.match(/(MS|PR)\d{2}/i)
    
    let name = ''
    if (yearMatch) name += yearMatch[0] + ' '
    if (mintMatch) name += mintMatch[0] + ' '
    
    // Find coin type keywords
    const keywords = ['Morgan', 'Peace', 'Eagle', 'Sacagawea', 'Liberty', 'Laser', 'Army', 'Navy']
    for (const kw of keywords) {
      if (title.toLowerCase().includes(kw.toLowerCase())) {
        name += kw + ' '
        break
      }
    }
    
    if (gradeMatch) name += gradeMatch[0].toUpperCase()
    
    return name.trim() || title.substring(0, 40)
  }

  const findBestMatch = (title) => {
    if (!coinTypes.length || !title) return null
    const titleLower = title.toLowerCase()
    
    for (const ct of coinTypes) {
      const ctNameLower = ct.name.toLowerCase()
      // Check if coin type name appears in title
      if (titleLower.includes(ctNameLower)) {
        return ct
      }
      // Check keywords
      if (ct.keywords) {
        for (const kw of ct.keywords) {
          if (titleLower.includes(kw.toLowerCase())) {
            return ct
          }
        }
      }
    }
    return null
  }

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile) return

    const ext = selectedFile.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setError('Please upload an Excel (.xlsx, .xls) or CSV file')
      return
    }

    setFile(selectedFile)
    setError('')
    setResults(null)
    setParsedData(null)

    try {
      const data = await selectedFile.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

      // Find header row
      let headerRowIdx = 0
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i].map(c => String(c).toLowerCase())
        if (row.includes('type') && row.some(c => c.includes('transaction') || c.includes('order'))) {
          headerRowIdx = i
          break
        }
      }

      const headers = rows[headerRowIdx].map(h => String(h).toLowerCase().trim())
      
      const findCol = (patterns) => headers.findIndex(h => patterns.some(p => h.includes(p)))
      
      const typeCol = findCol(['type'])
      const orderCol = findCol(['order number'])
      const itemIdCol = findCol(['item id'])
      const titleCol = findCol(['item title'])
      const dateCol = findCol(['transaction creation date'])
      const netAmountCol = findCol(['net amount'])
      const quantityCol = findCol(['quantity'])
      const grossCol = findCol(['gross transaction amount'])
      const feeFixedCol = findCol(['final value fee - fixed'])
      const feeVarCol = findCol(['final value fee - variable'])
      const adsCol = findCol(['ads'])
      const descCol = headers.indexOf('description')

      // Parse all rows - keep Order, Refund, Shipping label only
      const orders = []
      const refunds = []
      const shippingByOrder = {}

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i]
        const type = String(row[typeCol] || '').trim()
        const orderNumber = String(row[orderCol] || '').trim()

        if (type === 'Order') {
          const title = String(row[titleCol] || '').trim()
          if (!title || title === '--') continue
          
          orders.push({
            orderNumber,
            listingId: String(row[itemIdCol] || ''),
            itemTitle: title,
            grade: extractGrade(title),
            saleDate: row[dateCol] ? new Date(row[dateCol]).toISOString().split('T')[0] : null,
            salePrice: parseFloat(String(row[grossCol]).replace(/,/g, '')) || 0,
            ebayFee: Math.abs(parseFloat(String(row[feeFixedCol]).replace(/,/g, '')) || 0) + 
                     Math.abs(parseFloat(String(row[feeVarCol]).replace(/,/g, '')) || 0),
            advertisingFee: Math.abs(parseFloat(String(row[adsCol]).replace(/,/g, '')) || 0),
            netAmount: parseFloat(String(row[netAmountCol]).replace(/,/g, '')) || 0,
            quantity: parseInt(row[quantityCol]) || 1,
            type: 'order'
          })
        } else if (type === 'Refund') {
          // Refunds have negative amounts - track them
          const title = String(row[titleCol] || '').trim()
          refunds.push({
            orderNumber,
            itemTitle: title,
            refundAmount: Math.abs(parseFloat(String(row[netAmountCol]).replace(/,/g, '')) || 0),
            saleDate: row[dateCol] ? new Date(row[dateCol]).toISOString().split('T')[0] : null,
            type: 'refund'
          })
        } else if (type === 'Shipping label' && orderNumber && orderNumber !== '--') {
          // Shipping costs - accumulate by order
          const amount = Math.abs(parseFloat(String(row[netAmountCol]).replace(/,/g, '')) || 0)
          shippingByOrder[orderNumber] = (shippingByOrder[orderNumber] || 0) + amount
        }
      }

      // Create a map of refunds by order number
      const refundsByOrder = {}
      refunds.forEach(refund => {
        if (refund.orderNumber && refund.orderNumber !== '--') {
          refundsByOrder[refund.orderNumber] = refund
        }
      })

      // Merge shipping and check for refunds
      orders.forEach(order => {
        order.shippingCost = shippingByOrder[order.orderNumber] || 0
        
        // Calculate total payout: net from eBay minus shipping cost minus ads
        // Note: eBay's netAmount already has their fees deducted, but shipping and ads are separate
        order.totalPayout = order.netAmount - order.shippingCost - order.advertisingFee
        
        // Check if this order was refunded (for display purposes)
        if (refundsByOrder[order.orderNumber]) {
          order.isRefunded = true
          order.refundAmount = refundsByOrder[order.orderNumber].refundAmount
        }
      })

      // Add ALL refunds as separate negative transactions
      // This ensures refunds always offset member earnings
      refunds.forEach(refund => {
        orders.push({
          orderNumber: refund.orderNumber,
          itemTitle: refund.itemTitle || 'Refund',
          saleDate: refund.saleDate,
          salePrice: 0,
          totalPayout: -refund.refundAmount, // Negative payout
          quantity: 1,
          type: 'refund',
          isRefund: true
        })
      })

      // Get unique titles with counts and total revenue
      const titleStats = {}
      let totalRefunds = 0
      let refundCount = 0
      
      orders.forEach(order => {
        // Track refunds separately
        if (order.isRefund) {
          totalRefunds += Math.abs(order.totalPayout)
          refundCount++
          return
        }
        
        if (!titleStats[order.itemTitle]) {
          titleStats[order.itemTitle] = { 
            count: 0, 
            revenue: 0, 
            netPayout: 0,
            shippingCost: 0,
            advertisingFee: 0,
            refundedCount: 0,
            sample: order 
          }
        }
        titleStats[order.itemTitle].count += order.quantity
        titleStats[order.itemTitle].revenue += order.salePrice
        titleStats[order.itemTitle].netPayout += order.totalPayout
        titleStats[order.itemTitle].shippingCost += order.shippingCost || 0
        titleStats[order.itemTitle].advertisingFee += order.advertisingFee || 0
        
        if (order.isRefunded) {
          titleStats[order.itemTitle].refundedCount++
        }
      })

      // Sort by count descending
      const uniqueTitles = Object.entries(titleStats)
        .sort((a, b) => b[1].count - a[1].count)
        .map(([title, stats]) => ({
          title,
          count: stats.count,
          revenue: stats.revenue,
          netPayout: stats.netPayout,
          shippingCost: stats.shippingCost,
          advertisingFee: stats.advertisingFee,
          refundedCount: stats.refundedCount,
          sample: stats.sample
        }))

      // Initialize mappings with best guesses
      const initialMappings = {}
      const initialIncluded = {}
      
      uniqueTitles.forEach(({ title }) => {
        // Auto-include if looks like a coin
        const isCoin = looksLikeCoin(title)
        initialIncluded[title] = isCoin
        
        const match = findBestMatch(title)
        if (match) {
          initialMappings[title] = {
            action: 'map',
            coinTypeId: match.coin_type_id,
            matchedName: match.name
          }
        } else {
          initialMappings[title] = {
            action: 'create',
            newName: suggestName(title),
            cost: ''
          }
        }
      })

      setParsedData({
        filename: selectedFile.name,
        orders,
        uniqueTitles,
        totalOrders: orders.filter(o => !o.isRefund).length,
        totalRevenue: orders.filter(o => !o.isRefund).reduce((sum, o) => sum + o.salePrice, 0),
        totalShipping: orders.filter(o => !o.isRefund).reduce((sum, o) => sum + (o.shippingCost || 0), 0),
        totalAds: orders.filter(o => !o.isRefund).reduce((sum, o) => sum + (o.advertisingFee || 0), 0),
        totalNetPayout: orders.filter(o => !o.isRefund).reduce((sum, o) => sum + o.totalPayout, 0),
        refundCount,
        totalRefunds,
        refundedOrderCount: orders.filter(o => o.isRefunded).length
      })
      setTitleMappings(initialMappings)
      setIncludedTitles(initialIncluded)

    } catch (err) {
      setError('Error parsing file: ' + err.message)
    }
  }

  const updateMapping = (title, updates) => {
    setTitleMappings(prev => ({
      ...prev,
      [title]: { ...prev[title], ...updates }
    }))
  }

  const handleImport = async () => {
    if (!parsedData) return
    setImporting(true)
    setError('')

    try {
      // Filter orders to only include checked items (but always include refunds)
      const filteredOrders = parsedData.orders.filter(order => 
        order.isRefund || includedTitles[order.itemTitle]
      )
      
      // Filter titleMappings to only include checked items
      const filteredMappings = {}
      for (const [title, mapping] of Object.entries(titleMappings)) {
        if (includedTitles[title]) {
          filteredMappings[title] = mapping
        }
      }

      const response = await api.post('/upload', {
        transactions: filteredOrders,
        titleMappings: filteredMappings
      })
      setResults(response.data)
      fetchCoinTypes()
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const reset = () => {
    setFile(null)
    setParsedData(null)
    setResults(null)
    setError('')
    setTitleMappings({})
    setIncludedTitles({})
    setExpandedTitles({})
  }

  const toggleExpand = (title) => {
    setExpandedTitles(prev => ({ ...prev, [title]: !prev[title] }))
  }

  // Count only included items
  const includedCount = Object.values(includedTitles).filter(Boolean).length
  const excludedCount = parsedData?.uniqueTitles?.length - includedCount || 0
  const includedOrders = parsedData?.orders?.filter(o => !o.isRefund && includedTitles[o.itemTitle])?.length || 0
  const refundOrders = parsedData?.orders?.filter(o => o.isRefund)?.length || 0

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Import eBay Sales</h1>
          <p className="text-slate-500 mt-1">Upload your eBay transaction report and map items to coin types</p>
        </div>
        <button 
          onClick={async () => {
            if (confirm('Delete ALL sales transactions? This cannot be undone.')) {
              try {
                await api.delete('/upload?action=clearAll')
                alert('All sales cleared. You can now re-import.')
              } catch (err) {
                alert('Error clearing sales: ' + (err.response?.data?.error || err.message))
              }
            }
          }}
          className="btn btn-secondary text-red-600 hover:bg-red-50"
        >
          Clear All Sales
        </button>
      </div>

      {!parsedData && !results && (
        <div
          className={`card p-12 border-2 border-dashed transition-colors ${
            dragActive ? 'border-knox-500 bg-knox-50' : 'border-slate-300'
          }`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <div className="text-center">
            <UploadIcon className="w-12 h-12 text-slate-400 mx-auto mb-4" />
            <p className="text-lg text-slate-600 mb-2">Drop your eBay transaction file here</p>
            <p className="text-sm text-slate-500 mb-6">
              Download from eBay Seller Hub → Payments → Reports → Transaction report
            </p>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileSelect(e.target.files[0])}
            />
            <label htmlFor="file-upload" className="btn btn-primary cursor-pointer">
              Select File
            </label>
            <p className="text-xs text-slate-400 mt-4">Supports: .xlsx, .xls, .csv</p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {parsedData && !results && (
        <div className="space-y-6">
          {/* File Info */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">{parsedData.filename}</p>
                  <p className="text-sm text-slate-500">
                    {parsedData.totalOrders} orders • {parsedData.uniqueTitles.length} unique items
                  </p>
                </div>
              </div>
              <button onClick={reset} className="btn btn-secondary">Choose Different File</button>
            </div>
            
            {/* Financial Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 pt-3 border-t">
              <div className="text-center p-2 bg-slate-50 rounded">
                <p className="text-xs text-slate-500">Gross Revenue</p>
                <p className="font-semibold text-slate-900">${parsedData.totalRevenue.toLocaleString()}</p>
              </div>
              <div className="text-center p-2 bg-amber-50 rounded">
                <p className="text-xs text-amber-600">Shipping Costs</p>
                <p className="font-semibold text-amber-700">-${parsedData.totalShipping.toLocaleString()}</p>
              </div>
              {parsedData.totalAds > 0 && (
                <div className="text-center p-2 bg-purple-50 rounded">
                  <p className="text-xs text-purple-600">Ad Fees</p>
                  <p className="font-semibold text-purple-700">-${parsedData.totalAds.toLocaleString()}</p>
                </div>
              )}
              <div className="text-center p-2 bg-emerald-50 rounded">
                <p className="text-xs text-emerald-600">Net Payout</p>
                <p className="font-semibold text-emerald-700">${parsedData.totalNetPayout.toLocaleString()}</p>
              </div>
              {parsedData.refundCount > 0 && (
                <div className="text-center p-2 bg-red-50 rounded">
                  <p className="text-xs text-red-600">Refunds ({parsedData.refundCount})</p>
                  <p className="font-semibold text-red-700">-${parsedData.totalRefunds.toLocaleString()}</p>
                </div>
              )}
              {parsedData.refundedOrderCount > 0 && (
                <div className="text-center p-2 bg-orange-50 rounded">
                  <p className="text-xs text-orange-600">Orders with Refunds</p>
                  <p className="font-semibold text-orange-700">{parsedData.refundedOrderCount}</p>
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="flex gap-4">
            <div className="px-4 py-2 bg-emerald-50 rounded-lg">
              <span className="text-emerald-700 font-medium">{includedCount}</span>
              <span className="text-emerald-600 text-sm ml-1">included</span>
            </div>
            <div className="px-4 py-2 bg-slate-100 rounded-lg">
              <span className="text-slate-700 font-medium">{excludedCount}</span>
              <span className="text-slate-600 text-sm ml-1">excluded</span>
            </div>
            <div className="px-4 py-2 bg-knox-50 rounded-lg">
              <span className="text-knox-700 font-medium">{includedOrders}</span>
              <span className="text-knox-600 text-sm ml-1">orders to import</span>
            </div>
          </div>

          {/* Title Mappings */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="font-medium">Select Items to Import</h3>
                <p className="text-sm text-slate-500">Uncheck non-coin items (auto-detected). Then configure coin type mapping.</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIncludedTitles(Object.fromEntries(parsedData.uniqueTitles.map(t => [t.title, true])))}
                  className="text-xs text-knox-600 hover:underline"
                >
                  Select all
                </button>
                <span className="text-slate-300">|</span>
                <button 
                  onClick={() => setIncludedTitles(Object.fromEntries(parsedData.uniqueTitles.map(t => [t.title, false])))}
                  className="text-xs text-slate-500 hover:underline"
                >
                  Clear all
                </button>
              </div>
            </div>
            
            <div className="divide-y">
              {parsedData.uniqueTitles.map(({ title, count, revenue, shippingCost, advertisingFee, refundedCount }) => {
                const mapping = titleMappings[title] || {}
                const isExpanded = expandedTitles[title]
                const isIncluded = includedTitles[title]
                
                return (
                  <div key={title} className={`p-4 ${!isIncluded ? 'bg-slate-50 opacity-60' : ''}`}>
                    {/* Title Row */}
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <label className="flex items-center mt-0.5">
                        <input
                          type="checkbox"
                          checked={isIncluded || false}
                          onChange={(e) => setIncludedTitles(prev => ({ ...prev, [title]: e.target.checked }))}
                          className="w-4 h-4 text-knox-600 border-slate-300 rounded focus:ring-knox-500"
                        />
                      </label>
                      
                      <button 
                        onClick={() => toggleExpand(title)}
                        className="p-1 text-slate-400 hover:text-slate-600 mt-0.5"
                        disabled={!isIncluded}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-900 truncate" title={title}>{title}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {count} sold • ${revenue.toLocaleString()} revenue
                          {advertisingFee > 0 && <span className="text-purple-600"> • -${advertisingFee.toFixed(2)} ads</span>}
                          {shippingCost > 0 && <span className="text-amber-600"> • -${shippingCost.toFixed(2)} shipping</span>}
                          {refundedCount > 0 && <span className="text-red-500"> • {refundedCount} refunded</span>}
                        </p>
                      </div>

                      {/* Action indicator */}
                      {isIncluded && (
                        <div className="flex-shrink-0">
                          {mapping.action === 'map' && (
                            <span className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs">
                              → {mapping.matchedName}
                            </span>
                          )}
                          {mapping.action === 'create' && (
                            <span className="px-2 py-1 bg-knox-100 text-knox-700 rounded text-xs">
                              + {mapping.newName || 'New'}
                            </span>
                          )}
                          {mapping.action === 'skip' && (
                            <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded text-xs">
                              No cost
                            </span>
                          )}
                        </div>
                      )}
                      {!isIncluded && (
                        <span className="px-2 py-1 bg-red-50 text-red-500 rounded text-xs">
                          Excluded
                        </span>
                      )}
                    </div>

                    {/* Expanded Options - only show if included */}
                    {isExpanded && isIncluded && (
                      <div className="mt-4 ml-8 p-4 bg-slate-50 rounded-lg space-y-4">
                        {/* Action Select */}
                        <div className="flex items-center gap-4">
                          <label className="text-sm text-slate-600 w-20">Action:</label>
                          <select
                            className="input text-sm w-48"
                            value={mapping.action || 'create'}
                            onChange={(e) => {
                              const action = e.target.value
                              if (action === 'map') {
                                updateMapping(title, { action: 'map', coinTypeId: null, matchedName: null })
                              } else if (action === 'create') {
                                updateMapping(title, { action: 'create', newName: suggestName(title), cost: '' })
                              } else {
                                updateMapping(title, { action: 'skip' })
                              }
                            }}
                          >
                            <option value="create">Create new coin type</option>
                            <option value="map">Map to existing</option>
                            <option value="skip">Skip (no cost)</option>
                          </select>
                        </div>

                        {/* Map to existing */}
                        {mapping.action === 'map' && (
                          <div className="flex items-center gap-4">
                            <label className="text-sm text-slate-600 w-20">Coin Type:</label>
                            <select
                              className="input text-sm flex-1"
                              value={mapping.coinTypeId || ''}
                              onChange={(e) => {
                                const ct = coinTypes.find(c => c.coin_type_id === parseInt(e.target.value))
                                updateMapping(title, { 
                                  coinTypeId: parseInt(e.target.value),
                                  matchedName: ct?.name 
                                })
                              }}
                            >
                              <option value="">Select coin type...</option>
                              {coinTypes.map(ct => (
                                <option key={ct.coin_type_id} value={ct.coin_type_id}>
                                  {ct.name} - ${ct.original_price || 0}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}

                        {/* Create new */}
                        {mapping.action === 'create' && (
                          <>
                            <div className="flex items-center gap-4">
                              <label className="text-sm text-slate-600 w-20">Name:</label>
                              <input
                                type="text"
                                className="input text-sm flex-1"
                                value={mapping.newName || ''}
                                onChange={(e) => updateMapping(title, { newName: e.target.value })}
                                placeholder="Coin type name"
                              />
                            </div>
                            <div className="flex items-center gap-4">
                              <label className="text-sm text-slate-600 w-20">Cost:</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="input text-sm w-32 pl-7"
                                  value={mapping.cost || ''}
                                  onChange={(e) => updateMapping(title, { cost: e.target.value })}
                                  placeholder="0.00"
                                />
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Import Button */}
          <div className="flex justify-end gap-3">
            <button onClick={reset} className="btn btn-secondary">Cancel</button>
            <button 
              onClick={handleImport} 
              disabled={importing || includedOrders === 0} 
              className="btn btn-primary"
            >
              {importing ? 'Importing...' : `Import ${includedOrders} Orders${refundOrders > 0 ? ` + ${refundOrders} Refunds` : ''}`}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-6">
          <div className="card p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-emerald-100 rounded-full">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Import Complete</h2>
                <p className="text-slate-500">Successfully imported {results.imported} transactions</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="p-4 bg-emerald-50 rounded-lg">
                <p className="text-sm text-emerald-600 font-medium">Imported</p>
                <p className="text-2xl font-bold text-emerald-700">{results.imported}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 font-medium">Skipped</p>
                <p className="text-2xl font-bold text-slate-700">{results.skipped}</p>
              </div>
              {results.createdCoinTypes > 0 && (
                <div className="p-4 bg-knox-50 rounded-lg">
                  <p className="text-sm text-knox-600 font-medium">New Coin Types</p>
                  <p className="text-2xl font-bold text-knox-700">{results.createdCoinTypes}</p>
                </div>
              )}
            </div>

            {results.errors?.length > 0 && (
              <div className="p-4 bg-amber-50 rounded-lg">
                <p className="font-medium text-amber-800 mb-2">Warnings ({results.errors.length})</p>
                <ul className="text-sm text-amber-700 space-y-1">
                  {results.errors.map((err, i) => <li key={i}>• {err}</li>)}
                </ul>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={reset} className="btn btn-primary">Import Another File</button>
            <a href="/sales" className="btn btn-secondary">View Sales</a>
          </div>
        </div>
      )}
    </div>
  )
}
