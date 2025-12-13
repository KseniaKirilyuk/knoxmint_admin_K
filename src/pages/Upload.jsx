import { useState, useEffect, useCallback } from 'react'
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../lib/api'

export default function Upload() {
  const [file, setFile] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [coinTypes, setCoinTypes] = useState([])
  const [coinMappings, setCoinMappings] = useState({})
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)

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

  const extractCoinType = (title) => {
    if (!title || title === '--') return null
    const titleLower = title.toLowerCase()
    
    if (titleLower.includes('sacagawea')) return 'Sacagawea'
    if (titleLower.includes('liberty') && titleLower.includes('gold')) return 'Liberty'
    if (titleLower.includes('laser')) return 'Laser Privy'
    if (titleLower.includes('army')) return 'Army Privy'
    if (titleLower.includes('navy')) return 'Navy Privy'
    if (titleLower.includes('morgan')) return 'Morgan'
    if (titleLower.includes('peace')) return 'Peace'
    if (titleLower.includes('eagle')) return 'American Eagle'
    return null
  }

  const extractGrade = (title) => {
    if (!title) return null
    const match = title.match(/(MS|PR)\d{2}/i)
    return match ? match[0].toUpperCase() : null
  }

  const findBestMatch = (name) => {
    if (!coinTypes.length || !name) return null
    const nameLower = name.toLowerCase()
    
    const scored = coinTypes.map(ct => {
      const ctNameLower = ct.name.toLowerCase()
      const ctCodeLower = (ct.short_code || '').toLowerCase()
      
      if (ctNameLower === nameLower || ctCodeLower === nameLower) return { ct, score: 100 }
      if (ctNameLower.includes(nameLower) || nameLower.includes(ctNameLower)) return { ct, score: 80 }
      
      const nameWords = nameLower.split(/\s+/)
      const ctWords = ctNameLower.split(/\s+/)
      const matchingWords = nameWords.filter(w => ctWords.some(cw => cw.includes(w) || w.includes(cw)))
      if (matchingWords.length > 0) return { ct, score: 50 + matchingWords.length * 10 }
      
      return { ct, score: 0 }
    })
    
    const best = scored.sort((a, b) => b.score - a.score)[0]
    return best.score > 40 ? best.ct : null
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

      // Find header row (look for "Type" column)
      let headerRowIdx = 0
      for (let i = 0; i < Math.min(20, rows.length); i++) {
        const row = rows[i].map(c => String(c).toLowerCase())
        if (row.includes('type') && row.some(c => c.includes('transaction') || c.includes('order'))) {
          headerRowIdx = i
          break
        }
      }

      const headers = rows[headerRowIdx].map(h => String(h).toLowerCase().trim())
      
      // Find column indices
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

      // Parse orders
      const orders = []
      const shippingByOrder = {}
      const adsByOrder = {}

      for (let i = headerRowIdx + 1; i < rows.length; i++) {
        const row = rows[i]
        const type = String(row[typeCol] || '').trim()
        const orderNumber = String(row[orderCol] || '').trim()

        if (type === 'Order') {
          const title = String(row[titleCol] || '')
          const coinType = extractCoinType(title)
          
          orders.push({
            orderNumber,
            listingId: String(row[itemIdCol] || ''),
            itemTitle: title,
            coinType,
            grade: extractGrade(title),
            saleDate: row[dateCol] ? new Date(row[dateCol]).toISOString().split('T')[0] : null,
            salePrice: parseFloat(row[grossCol]) || 0,
            ebayFee: (parseFloat(row[feeFixedCol]) || 0) + (parseFloat(row[feeVarCol]) || 0),
            totalPayout: parseFloat(row[netAmountCol]) || 0,
            quantity: parseInt(row[quantityCol]) || 1
          })
        } else if (type === 'Shipping label' && orderNumber) {
          shippingByOrder[orderNumber] = (shippingByOrder[orderNumber] || 0) + Math.abs(parseFloat(row[netAmountCol]) || 0)
        } else if (type === 'Other fee' && orderNumber) {
          const desc = String(row[headers.indexOf('description')] || '')
          if (desc.toLowerCase().includes('promoted')) {
            adsByOrder[orderNumber] = (adsByOrder[orderNumber] || 0) + Math.abs(parseFloat(row[netAmountCol]) || 0)
          }
        }
      }

      // Merge shipping and ads into orders
      orders.forEach(order => {
        order.shippingCost = shippingByOrder[order.orderNumber] || 0
        order.advertisingFee = adsByOrder[order.orderNumber] || 0
        // Adjust total payout to add back shipping (since we track it separately)
        order.totalPayout = order.totalPayout + order.shippingCost
      })

      // Find unique coin types and match to existing
      const uniqueTypes = [...new Set(orders.map(o => o.coinType).filter(Boolean))]
      const matched = []
      const unmatched = []
      const initialMappings = {}

      uniqueTypes.forEach(type => {
        const match = findBestMatch(type)
        if (match) {
          matched.push({ name: type, matchedId: match.coin_type_id, matchedName: match.name })
          initialMappings[type] = match.coin_type_id
        } else {
          unmatched.push({ name: type })
        }
      })

      setParsedData({
        filename: selectedFile.name,
        orders,
        totalOrders: orders.length,
        totalRevenue: orders.reduce((sum, o) => sum + o.salePrice, 0),
        matched,
        unmatched,
        uniqueTypes
      })
      setCoinMappings(initialMappings)

    } catch (err) {
      setError('Error parsing file: ' + err.message)
    }
  }

  const handleImport = async () => {
    if (!parsedData) return
    setImporting(true)
    setError('')

    try {
      const response = await api.post('/upload', {
        transactions: parsedData.orders,
        coinMappings
      })
      setResults(response.data)
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
    setCoinMappings({})
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import eBay Sales</h1>
        <p className="text-slate-500 mt-1">Upload your eBay transaction report (CSV or Excel)</p>
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
          <div className="card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">{parsedData.filename}</p>
                <p className="text-sm text-slate-500">
                  {parsedData.totalOrders} orders • ${parsedData.totalRevenue.toLocaleString()} revenue
                </p>
              </div>
            </div>
            <button onClick={reset} className="btn btn-secondary">Choose Different File</button>
          </div>

          {/* Matched Coins */}
          {parsedData.matched.length > 0 && (
            <div className="card p-4 border-emerald-200 bg-emerald-50">
              <p className="text-sm font-medium text-emerald-800 mb-2 flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Matched Coin Types ({parsedData.matched.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {parsedData.matched.map(ct => (
                  <span key={ct.name} className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-sm">
                    {ct.name} → {ct.matchedName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Unmatched Coins */}
          {parsedData.unmatched.length > 0 && (
            <div className="card p-4 border-amber-200 bg-amber-50">
              <p className="text-sm font-medium text-amber-800 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Map Unmatched Coin Types ({parsedData.unmatched.length})
              </p>
              <div className="space-y-3">
                {parsedData.unmatched.map(ct => (
                  <div key={ct.name} className="flex items-center gap-3">
                    <span className="text-sm font-medium text-amber-800 w-32 truncate">{ct.name}</span>
                    <span className="text-slate-400">→</span>
                    <select
                      className="input text-sm flex-1"
                      value={coinMappings[ct.name] || ''}
                      onChange={(e) => setCoinMappings({
                        ...coinMappings,
                        [ct.name]: e.target.value ? parseInt(e.target.value) : null
                      })}
                    >
                      <option value="">Skip (no coin cost)</option>
                      <optgroup label="Existing coin types">
                        {coinTypes.map(existing => (
                          <option key={existing.coin_type_id} value={existing.coin_type_id}>
                            {existing.name} (${existing.original_price || 0})
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preview Table */}
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b bg-slate-50">
              <h3 className="font-medium">Preview (first 10 orders)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Fees</th>
                    <th className="px-3 py-2 text-right">Ship</th>
                    <th className="px-3 py-2 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedData.orders.slice(0, 10).map((order, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-2">{order.saleDate}</td>
                      <td className="px-3 py-2">
                        <span className="px-2 py-0.5 bg-knox-50 text-knox-700 rounded text-xs">
                          {order.coinType || 'Unknown'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">${order.salePrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right text-red-600">${Math.abs(order.ebayFee).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">${order.shippingCost.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-medium">${order.totalPayout.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Import Button */}
          <div className="flex justify-end gap-3">
            <button onClick={reset} className="btn btn-secondary">Cancel</button>
            <button onClick={handleImport} disabled={importing} className="btn btn-primary">
              {importing ? 'Importing...' : `Import ${parsedData.totalOrders} Orders`}
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

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="p-4 bg-emerald-50 rounded-lg">
                <p className="text-sm text-emerald-600 font-medium">Imported</p>
                <p className="text-2xl font-bold text-emerald-700">{results.imported}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-600 font-medium">Skipped (duplicates)</p>
                <p className="text-2xl font-bold text-slate-700">{results.skipped}</p>
              </div>
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
