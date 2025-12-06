import { useState, useCallback } from 'react'
import { Upload as UploadIcon, FileSpreadsheet, CheckCircle, AlertCircle, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../lib/api'

export default function Upload() {
  const [file, setFile] = useState(null)
  const [sheets, setSheets] = useState({})
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [selectedSheets, setSelectedSheets] = useState([])
  const [dragActive, setDragActive] = useState(false)

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
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0])
    }
  }, [])

  const parseExcelDate = (value) => {
    if (!value) return null
    
    // Handle Date objects (from cellDates: true)
    if (value instanceof Date) {
      return value.toISOString().split('T')[0]
    }
    
    // Handle strings like "7/23/2023" or "07/23/2023"
    if (typeof value === 'string') {
      // Try M/D/YYYY or MM/DD/YYYY format
      const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      if (mdyMatch) {
        const [, month, day, year] = mdyMatch
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
      }
      
      // Try standard parsing
      const parsed = new Date(value)
      if (!isNaN(parsed)) {
        return parsed.toISOString().split('T')[0]
      }
      return null
    }
    
    // Handle Excel serial numbers
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value)
      if (date) {
        return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
      }
    }
    return null
  }

  const parseTransactions = (sheetData, sheetName) => {
    if (!sheetData || sheetData.length < 2) return []
    
    const headers = sheetData[0].map(h => String(h || '').toLowerCase().trim())
    const transactions = []

    const findColumn = (patterns) => {
      for (const pattern of patterns) {
        const idx = headers.findIndex(h => h.includes(pattern))
        if (idx !== -1) return idx
      }
      return -1
    }

    const listingCol = findColumn(['listing', 'item'])
    const dateCol = findColumn(['date sold', 'sale date', 'date'])
    const priceCol = findColumn(['price sold', 'sale price', 'price', 'sold'])
    const ebayFeeCol = findColumn(['ebay fee', 'ebay', 'fee'])
    const adFeeCol = findColumn(['ad fee', 'advertising', 'promoted'])
    const shippingCol = findColumn(['shipping', 'ship'])
    const costCol = findColumn(['cost', 'coin cost', 'total cost'])
    const profitShareCol = findColumn(['profit share', 'share'])

    for (let i = 1; i < sheetData.length; i++) {
      const row = sheetData[i]
      if (!row || row.length === 0) continue

      const price = priceCol >= 0 ? parseFloat(row[priceCol]) : 0
      if (!price || isNaN(price)) continue

      transactions.push({
        listingId: listingCol >= 0 ? String(row[listingCol] || '') : '',
        saleDate: dateCol >= 0 ? parseExcelDate(row[dateCol]) : null,
        salePrice: price,
        ebayFee: ebayFeeCol >= 0 ? parseFloat(row[ebayFeeCol]) || 0 : 0,
        advertisingFee: adFeeCol >= 0 ? parseFloat(row[adFeeCol]) || 0 : 0,
        shippingCost: shippingCol >= 0 ? parseFloat(row[shippingCol]) || 0 : 0,
        coinCost: costCol >= 0 ? parseFloat(row[costCol]) || 0 : 0,
        profitShare: profitShareCol >= 0 ? parseFloat(row[profitShareCol]) || null : null,
      })
    }

    return transactions
  }

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile) return

    const ext = selectedFile.name.split('.').pop().toLowerCase()
    if (!['xlsx', 'xls', 'csv'].includes(ext)) {
      setError('Please upload an Excel file (.xlsx, .xls) or CSV file')
      return
    }

    setFile(selectedFile)
    setError('')
    setResults(null)
    setSheets({})

    try {
      const data = await selectedFile.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array', cellDates: true })
      
      const parsedSheets = {}
      
      for (const sheetName of workbook.SheetNames) {
        if (sheetName.toLowerCase() === 'payouts') continue

        const worksheet = workbook.Sheets[sheetName]
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
        
        if (sheetData.length > 1) {
          const transactions = parseTransactions(sheetData, sheetName)
          parsedSheets[sheetName] = {
            headers: sheetData[0],
            rows: sheetData.slice(1, 5),
            totalRows: sheetData.length - 1,
            transactions,
            transactionCount: transactions.length
          }
        }
      }

      setSheets(parsedSheets)
      setSelectedSheets(Object.keys(parsedSheets))
    } catch (err) {
      setError('Error parsing file: ' + err.message)
    }
  }

  const handleImport = async () => {
    if (selectedSheets.length === 0) return

    setImporting(true)
    setError('')

    const allResults = {
      imported: 0,
      skipped: 0,
      errors: [],
      bySheet: {}
    }

    try {
      for (const sheetName of selectedSheets) {
        const sheetData = sheets[sheetName]
        if (!sheetData || sheetData.transactions.length === 0) continue

        try {
          const response = await api.post('/upload', {
            transactions: sheetData.transactions,
            groupName: sheetName
          })

          allResults.imported += response.data.imported || 0
          allResults.skipped += response.data.skipped || 0
          if (response.data.errors) {
            allResults.errors.push(...response.data.errors)
          }
          allResults.bySheet[sheetName] = {
            imported: response.data.imported || 0,
            skipped: response.data.skipped || 0
          }
        } catch (err) {
          allResults.errors.push(`${sheetName}: ${err.response?.data?.error || err.message}`)
          allResults.bySheet[sheetName] = { imported: 0, skipped: 0, error: true }
        }
      }

      setResults(allResults)
    } catch (err) {
      setError(err.response?.data?.error || 'Error importing data')
    } finally {
      setImporting(false)
    }
  }

  const toggleSheet = (sheetName) => {
    setSelectedSheets(prev => 
      prev.includes(sheetName)
        ? prev.filter(s => s !== sheetName)
        : [...prev, sheetName]
    )
  }

  const reset = () => {
    setFile(null)
    setSheets({})
    setResults(null)
    setError('')
    setSelectedSheets([])
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import Data</h1>
        <p className="text-slate-500 mt-1">Upload Excel files to import sales transactions</p>
      </div>

      {Object.keys(sheets).length === 0 && !results && (
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
            <div className="mx-auto w-16 h-16 bg-knox-100 rounded-full flex items-center justify-center mb-4">
              <UploadIcon className="w-8 h-8 text-knox-600" />
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">
              Drop your Excel file here
            </h3>
            <p className="text-slate-500 mb-4">or click to browse</p>
            <input
              type="file"
              id="file-upload"
              className="hidden"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileSelect(e.target.files[0])}
            />
            <label
              htmlFor="file-upload"
              className="btn btn-primary cursor-pointer"
            >
              Select File
            </label>
            <p className="text-xs text-slate-400 mt-4">
              Supported formats: .xlsx, .xls, .csv
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {Object.keys(sheets).length > 0 && !results && (
        <div className="space-y-6">
          <div className="card p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">{file?.name}</p>
                <p className="text-sm text-slate-500">
                  {Object.keys(sheets).length} sheets with transactions found
                </p>
              </div>
            </div>
            <button onClick={reset} className="btn btn-secondary">
              Choose Different File
            </button>
          </div>

          <div className="card">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Select Sheets to Import</h2>
              <p className="text-sm text-slate-500 mt-1">
                Each sheet will be imported as a separate group (NGC FDI, PCGS RP FS, etc.)
              </p>
            </div>
            <div className="p-6 space-y-4">
              {Object.entries(sheets).map(([sheetName, data]) => (
                <div key={sheetName} className="border rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleSheet(sheetName)}
                    className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${
                      selectedSheets.includes(sheetName)
                        ? 'bg-knox-50 border-knox-200'
                        : 'bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedSheets.includes(sheetName)
                          ? 'bg-knox-600 border-knox-600'
                          : 'border-slate-300'
                      }`}>
                        {selectedSheets.includes(sheetName) && (
                          <CheckCircle className="w-4 h-4 text-white" />
                        )}
                      </div>
                      <span className="font-medium">{sheetName}</span>
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">
                        {data.transactionCount} transactions
                      </span>
                    </div>
                    <span className="text-sm text-slate-500">
                      {data.totalRows} rows
                    </span>
                  </button>
                  
                  {selectedSheets.includes(sheetName) && data.rows.length > 0 && (
                    <div className="overflow-x-auto border-t">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-100">
                            {data.headers.slice(0, 8).map((h, i) => (
                              <th key={i} className="px-3 py-2 text-left font-medium text-slate-600">
                                {h || `Col ${i + 1}`}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {data.rows.slice(0, 3).map((row, ri) => (
                            <tr key={ri} className="border-t">
                              {row.slice(0, 8).map((cell, ci) => (
                                <td key={ci} className="px-3 py-2 text-slate-600">
                                  {cell?.toString() || '-'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3">
              <button onClick={reset} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={selectedSheets.length === 0 || importing}
                className="btn btn-primary"
              >
                {importing ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Importing...
                  </span>
                ) : (
                  `Import ${selectedSheets.length} Sheet${selectedSheets.length !== 1 ? 's' : ''}`
                )}
              </button>
            </div>
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
                <p className="text-slate-500">
                  Successfully imported {results.imported} transactions
                </p>
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

            {results.bySheet && Object.keys(results.bySheet).length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-4 py-2 text-left font-medium">Sheet / Group</th>
                      <th className="px-4 py-2 text-right font-medium">Imported</th>
                      <th className="px-4 py-2 text-right font-medium">Skipped</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(results.bySheet).map(([sheet, data]) => (
                      <tr key={sheet} className="border-t">
                        <td className="px-4 py-2">{sheet}</td>
                        <td className="px-4 py-2 text-right text-emerald-600">{data.imported}</td>
                        <td className="px-4 py-2 text-right text-slate-500">{data.skipped}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {results.errors && results.errors.length > 0 && (
              <div className="mt-4 p-4 bg-amber-50 rounded-lg">
                <p className="font-medium text-amber-800 mb-2">Warnings ({results.errors.length})</p>
                <ul className="text-sm text-amber-700 space-y-1 max-h-32 overflow-y-auto">
                  {results.errors.map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button onClick={reset} className="btn btn-primary">
            Import Another File
          </button>
        </div>
      )}
    </div>
  )
}
