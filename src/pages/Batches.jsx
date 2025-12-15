import { useState, useEffect, useCallback } from 'react'
import { Plus, Upload as UploadIcon, Calendar, Package, Users, X, Edit2, Trash2, ChevronDown, ChevronUp, FileSpreadsheet, CheckCircle, AlertCircle, DollarSign } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../lib/api'

export default function Batches() {
  const [batches, setBatches] = useState([])
  const [coinTypes, setCoinTypes] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedBatch, setExpandedBatch] = useState(null)
  const [batchDetails, setBatchDetails] = useState(null)
  
  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showPricesModal, setShowPricesModal] = useState(false)
  
  // Form data
  const [createForm, setCreateForm] = useState({ batchName: '', shipDate: '', grader: '', notes: '' })
  const [editForm, setEditForm] = useState({})
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  
  // Upload state
  const [uploadData, setUploadData] = useState(null)
  const [uploadResults, setUploadResults] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [error, setError] = useState('')
  const [coinPrices, setCoinPrices] = useState({})
  const [coinMappings, setCoinMappings] = useState({}) // Maps unmatched coin names to selected coin_type_id

  // Fuzzy match helper - find best matching coin type
  const findBestMatch = (name) => {
    if (!coinTypes.length) return null
    const nameLower = name.toLowerCase()
    
    // Score each coin type
    const scored = coinTypes.map(ct => {
      const ctNameLower = ct.name.toLowerCase()
      const ctCodeLower = (ct.short_code || '').toLowerCase()
      
      // Exact match
      if (ctNameLower === nameLower || ctCodeLower === nameLower) return { ct, score: 100 }
      
      // Contains match
      if (ctNameLower.includes(nameLower) || nameLower.includes(ctNameLower)) return { ct, score: 80 }
      if (ctCodeLower.includes(nameLower) || nameLower.includes(ctCodeLower)) return { ct, score: 70 }
      
      // Word match (e.g., "Laser" matches "Laser Privy")
      const nameWords = nameLower.split(/\s+/)
      const ctWords = ctNameLower.split(/\s+/)
      const matchingWords = nameWords.filter(w => ctWords.some(cw => cw.includes(w) || w.includes(cw)))
      if (matchingWords.length > 0) return { ct, score: 50 + matchingWords.length * 10 }
      
      return { ct, score: 0 }
    })
    
    const best = scored.sort((a, b) => b.score - a.score)[0]
    return best.score > 40 ? best.ct : null
  }

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [batchesRes, coinTypesRes, usersRes] = await Promise.all([
        api.get('/batches'),
        api.get('/batches?action=coinTypes'),
        api.get('/users')
      ])
      setBatches(batchesRes.data)
      setCoinTypes(coinTypesRes.data)
      setUsers(usersRes.data.filter(u => u.role !== 'admin'))
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchBatchDetails = async (batchId) => {
    try {
      const res = await api.get(`/batches?action=details&batchId=${batchId}`)
      setBatchDetails(res.data)
    } catch (error) {
      console.error('Error fetching batch details:', error)
    }
  }

  const toggleExpand = async (batchId) => {
    if (expandedBatch === batchId) {
      setExpandedBatch(null)
      setBatchDetails(null)
    } else {
      setExpandedBatch(batchId)
      await fetchBatchDetails(batchId)
    }
  }

  // Create batch
  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      await api.post('/batches', { action: 'create', ...createForm })
      setShowCreateModal(false)
      setCreateForm({ batchName: '', shipDate: '', grader: '', notes: '' })
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Error creating batch')
    }
  }

  // Edit batch
  const handleEdit = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/batches?batchId=${selectedBatchId}`, editForm)
      setShowEditModal(false)
      fetchData()
      if (expandedBatch === selectedBatchId) {
        fetchBatchDetails(selectedBatchId)
      }
    } catch (err) {
      alert(err.response?.data?.error || 'Error updating batch')
    }
  }

  // Delete batch
  const handleDelete = async (batchId) => {
    if (!confirm('Delete this batch and all its contributions?')) return
    try {
      await api.delete(`/batches?batchId=${batchId}`)
      fetchData()
      if (expandedBatch === batchId) {
        setExpandedBatch(null)
        setBatchDetails(null)
      }
    } catch (err) {
      alert('Error deleting batch')
    }
  }

  // Update prices
  const handleSavePrices = async () => {
    try {
      await api.put(`/batches?batchId=${selectedBatchId}`, { coinPrices })
      setShowPricesModal(false)
      fetchBatchDetails(selectedBatchId)
    } catch (err) {
      alert('Error saving prices')
    }
  }

  // File upload handlers
  const handleDrag = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true)
    else if (e.type === 'dragleave') setDragActive(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) handleFileSelect(e.dataTransfer.files[0])
  }, [])

  const handleFileSelect = async (file) => {
    setError('')
    setUploadResults(null)
    setCoinPrices({})

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

      if (rows.length < 2) {
        setError('Spreadsheet appears to be empty')
        return
      }

      // Parse headers - find coin type columns
      const headers = rows[0]
      const memberColIdx = headers.findIndex(h => 
        String(h).toLowerCase().includes('slack') || 
        String(h).toLowerCase().includes('name') ||
        String(h).toLowerCase().includes('member')
      )

      if (memberColIdx === -1) {
        setError('Could not find member name column (Slack Name)')
        return
      }

      // Find coin columns (columns with "Qty" in header)
      const coinColumns = []
      headers.forEach((h, idx) => {
        if (idx === memberColIdx) return
        const headerStr = String(h).toLowerCase()
        if (headerStr.includes('qty') || headerStr.includes('quantity')) {
          // Extract coin type name (remove "Qty" suffix)
          let coinName = String(h).replace(/\s*qty\s*/i, '').replace(/\s*quantity\s*/i, '').trim()
          if (coinName) {
            coinColumns.push({ idx, name: coinName })
          }
        }
      })

      if (coinColumns.length === 0) {
        setError('Could not find coin quantity columns (e.g., "Sacagawea Qty")')
        return
      }

      // Match coin columns against known coin types
      const matchedCoins = []
      const unmatchedCoins = []
      
      for (const col of coinColumns) {
        const match = coinTypes.find(ct => 
          ct.name.toLowerCase() === col.name.toLowerCase() ||
          ct.short_code?.toLowerCase() === col.name.toLowerCase()
        )
        if (match) {
          matchedCoins.push({ ...col, coinTypeId: match.coin_type_id, matchedName: match.name })
        } else {
          unmatchedCoins.push(col)
        }
      }

      // Parse contributions
      const contributions = []
      const priceRow = rows.findIndex(row => 
        String(row[0]).toLowerCase().includes('price') ||
        String(row[0]).toLowerCase().includes('original')
      )
      const currentPriceRow = rows.findIndex(row => 
        String(row[0]).toLowerCase().includes('current')
      )

      // Parse member contributions
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        const memberName = String(row[memberColIdx]).trim()
        
        // Stop at price rows
        if (memberName.toLowerCase().includes('price') || 
            memberName.toLowerCase().includes('original') ||
            memberName.toLowerCase().includes('current')) break
        
        if (!memberName) continue

        for (const col of coinColumns) {
          const qty = parseInt(row[col.idx]) || 0
          if (qty > 0) {
            contributions.push({
              memberName,
              coinType: col.name,
              quantity: qty
            })
          }
        }
      }

      // Parse prices if found
      const parsedPrices = {}
      if (priceRow !== -1) {
        for (const col of coinColumns) {
          const originalPrice = parseFloat(rows[priceRow][col.idx]) || null
          const currentPrice = currentPriceRow !== -1 ? parseFloat(rows[currentPriceRow][col.idx]) || null : null
          parsedPrices[col.name] = { original: originalPrice, current: currentPrice }
        }
      }

      // Initialize suggested mappings for unmatched coins
      const initialMappings = {}
      for (const unmatched of unmatchedCoins) {
        const suggestion = findBestMatch(unmatched.name)
        if (suggestion) {
          initialMappings[unmatched.name] = suggestion.coin_type_id
        }
      }

      setUploadData({
        filename: file.name,
        contributions,
        coinTypes: coinColumns.map(c => c.name),
        matchedCoins,
        unmatchedCoins,
        memberCount: [...new Set(contributions.map(c => c.memberName))].length,
        prices: parsedPrices
      })
      setCoinPrices(parsedPrices)
      setCoinMappings(initialMappings)

    } catch (err) {
      setError('Error parsing file: ' + err.message)
    }
  }

  const handleUpload = async () => {
    if (!uploadData || !selectedBatchId) return
    setUploading(true)
    setError('')

    try {
      // Map coin names/IDs to their cost per coin
      const pricesByTypeId = {}
      for (const [key, price] of Object.entries(coinPrices)) {
        if (!price) continue
        
        // Key could be a coin_type_id (number) or coin name (string)
        if (!isNaN(key)) {
          // It's already a coin_type_id
          pricesByTypeId[key] = price
        } else {
          // It's a coin name - find or use mapping
          const mappedId = coinMappings[key]
          if (mappedId) {
            pricesByTypeId[mappedId] = price
          } else {
            const coinType = coinTypes.find(ct => ct.name.toLowerCase() === key.toLowerCase())
            if (coinType) {
              pricesByTypeId[coinType.coin_type_id] = price
            }
          }
        }
      }

      const response = await api.post('/batches', {
        action: 'uploadContributions',
        batchId: selectedBatchId,
        contributions: uploadData.contributions,
        coinPrices: pricesByTypeId,
        coinMappings // Pass mappings to server
      })
      setUploadResults(response.data)
      fetchData()
      if (expandedBatch === selectedBatchId) {
        fetchBatchDetails(selectedBatchId)
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const resetUpload = () => {
    setUploadData(null)
    setUploadResults(null)
    setError('')
    setCoinPrices({})
    setCoinMappings({})
  }

  const openUploadModal = (batchId) => {
    setSelectedBatchId(batchId)
    resetUpload()
    setShowUploadModal(true)
  }

  const openEditModal = (batch) => {
    setSelectedBatchId(batch.batch_id)
    setEditForm({
      batchName: batch.batch_name,
      shipDate: batch.ship_date?.split('T')[0] || '',
      grader: batch.grader || '',
      status: batch.status,
      notes: batch.notes || ''
    })
    setShowEditModal(true)
  }

  const openPricesModal = (batch) => {
    setSelectedBatchId(batch.batch_id)
    // Initialize prices from batch details
    const prices = {}
    batchDetails?.coins?.forEach(coin => {
      prices[coin.coin_type_id] = {
        original: coin.original_price || '',
        current: coin.current_price || ''
      }
    })
    setCoinPrices(prices)
    setShowPricesModal(true)
  }

  // Group contributions by coin type
  const groupContributions = (contributions) => {
    return contributions?.reduce((acc, contrib) => {
      const key = contrib.coin_type_name
      if (!acc[key]) {
        acc[key] = { total: 0, members: [] }
      }
      acc[key].total += parseInt(contrib.quantity) || 0
      acc[key].members.push(contrib)
      return acc
    }, {}) || {}
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Batches</h1>
          <p className="text-slate-500 mt-1">Manage grader shipments and member contributions</p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn btn-primary gap-2">
          <Plus className="w-4 h-4" />
          New Batch
        </button>
      </div>

      {/* Batches List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600"></div>
        </div>
      ) : batches.length === 0 ? (
        <div className="card p-12 text-center">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No batches yet</h3>
          <p className="text-slate-500 mb-4">Create your first batch to start tracking contributions</p>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary">
            Create Batch
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {batches.map((batch) => (
            <div key={batch.batch_id} className="card">
              {/* Batch Header */}
              <div 
                className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-slate-50"
                onClick={() => toggleExpand(batch.batch_id)}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-knox-100 rounded-lg">
                    <Package className="w-5 h-5 text-knox-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{batch.batch_name}</h3>
                    <div className="flex items-center gap-4 text-sm text-slate-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        {formatDate(batch.ship_date)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        {batch.contributor_count || 0} contributors
                      </span>
                      <span>{batch.total_coins || 0} coins</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    batch.status === 'Active' ? 'bg-emerald-100 text-emerald-700' :
                    batch.status === 'Closed' ? 'bg-slate-100 text-slate-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {batch.status}
                  </span>
                  {expandedBatch === batch.batch_id ? 
                    <ChevronUp className="w-5 h-5 text-slate-400" /> : 
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  }
                </div>
              </div>

              {/* Expanded Details */}
              {expandedBatch === batch.batch_id && batchDetails && (
                <div className="border-t">
                  {/* Action Buttons */}
                  <div className="px-6 py-3 bg-slate-50 flex gap-2">
                    <button onClick={() => openUploadModal(batch.batch_id)} className="btn btn-secondary btn-sm gap-1">
                      <UploadIcon className="w-4 h-4" /> Upload Contributions
                    </button>
                    <button onClick={() => openPricesModal(batch)} className="btn btn-secondary btn-sm gap-1">
                      <DollarSign className="w-4 h-4" /> Edit Prices
                    </button>
                    <button onClick={() => openEditModal(batch)} className="btn btn-secondary btn-sm gap-1">
                      <Edit2 className="w-4 h-4" /> Edit Batch
                    </button>
                    <button onClick={() => handleDelete(batch.batch_id)} className="btn btn-secondary btn-sm gap-1 text-red-600 hover:bg-red-50">
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>

                  {/* Coins & Prices */}
                  {batchDetails.coins?.length > 0 && (
                    <div className="px-6 py-4 border-b">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-900">Coin Types & Cost per Coin</h4>
                        <button 
                          onClick={() => {
                            // Initialize prices from current batch coins
                            const prices = {}
                            batchDetails.coins.forEach(c => {
                              prices[c.coin_type_id] = c.cost_per_coin || ''
                            })
                            setCoinPrices(prices)
                            setSelectedBatchId(expandedBatch)
                            setShowPricesModal(true)
                          }}
                          className="text-sm text-knox-600 hover:underline"
                        >
                          Edit Prices
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {batchDetails.coins.map(coin => (
                          <div key={coin.id} className="p-3 bg-slate-50 rounded-lg">
                            <p className="font-medium text-sm">{coin.coin_type_name}</p>
                            <p className="text-xs text-slate-500">{coin.total_contributed} coins</p>
                            <div className="mt-1 text-sm">
                              {coin.cost_per_coin ? (
                                <span className="text-emerald-600 font-medium">${parseFloat(coin.cost_per_coin).toFixed(2)}</span>
                              ) : (
                                <span className="text-amber-600">No price set</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Contributions by Coin Type */}
                  {batchDetails.contributions?.length > 0 ? (
                    <div className="px-6 py-4">
                      <h4 className="font-medium text-slate-900 mb-3">Contributions</h4>
                      {Object.entries(groupContributions(batchDetails.contributions)).map(([coinType, data]) => (
                        <div key={coinType} className="mb-4 last:mb-0">
                          <p className="text-sm font-medium text-slate-700 mb-2">{coinType} ({data.total} total)</p>
                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            {data.members.map(contrib => (
                              <div key={contrib.id} className="px-3 py-2 bg-slate-50 rounded text-sm">
                                <span className="font-medium">{contrib.full_name || contrib.username}</span>
                                <span className="text-slate-500 ml-2">{contrib.quantity}</span>
                                <span className="text-slate-400 ml-1">
                                  ({((contrib.quantity / data.total) * 100).toFixed(1)}%)
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-6 py-8 text-center text-slate-500">
                      No contributions yet. Upload a spreadsheet to add contributions.
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Batch Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Create New Batch</h2>
              <button onClick={() => setShowCreateModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="label">Batch Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., October 2024"
                  value={createForm.batchName}
                  onChange={(e) => setCreateForm({ ...createForm, batchName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Ship Date</label>
                <input
                  type="date"
                  className="input"
                  value={createForm.shipDate}
                  onChange={(e) => setCreateForm({ ...createForm, shipDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Grader</label>
                <select
                  className="input"
                  value={createForm.grader}
                  onChange={(e) => setCreateForm({ ...createForm, grader: e.target.value })}
                >
                  <option value="">Select grader</option>
                  <option value="NGC">NGC</option>
                  <option value="PCGS">PCGS</option>
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input"
                  rows={2}
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  Create Batch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Batch Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Batch</h2>
              <button onClick={() => setShowEditModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="p-6 space-y-4">
              <div>
                <label className="label">Batch Name *</label>
                <input
                  type="text"
                  className="input"
                  value={editForm.batchName}
                  onChange={(e) => setEditForm({ ...editForm, batchName: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Ship Date</label>
                <input
                  type="date"
                  className="input"
                  value={editForm.shipDate}
                  onChange={(e) => setEditForm({ ...editForm, shipDate: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Grader</label>
                <select
                  className="input"
                  value={editForm.grader}
                  onChange={(e) => setEditForm({ ...editForm, grader: e.target.value })}
                >
                  <option value="">Select grader</option>
                  <option value="NGC">NGC</option>
                  <option value="PCGS">PCGS</option>
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  className="input"
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                >
                  <option value="Active">Active</option>
                  <option value="Closed">Closed</option>
                  <option value="Paid">Paid</option>
                </select>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input"
                  rows={2}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowEditModal(false)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Prices Modal */}
      {showPricesModal && batchDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Cost per Coin</h2>
              <button onClick={() => setShowPricesModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-96 overflow-y-auto">
              {batchDetails.coins?.map(coin => (
                <div key={coin.id} className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{coin.coin_type_name}</p>
                    <p className="text-xs text-slate-500">{coin.total_contributed} coins</p>
                  </div>
                  <div className="w-32">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        className="input pl-7 text-right"
                        placeholder="0.00"
                        value={coinPrices[coin.coin_type_id] || ''}
                        onChange={(e) => setCoinPrices({
                          ...coinPrices,
                          [coin.coin_type_id]: e.target.value
                        })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <button onClick={() => setShowPricesModal(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={handleSavePrices} className="btn btn-primary flex-1">
                Save Prices
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">Upload Contributions</h2>
              <button onClick={() => { setShowUploadModal(false); resetUpload(); }} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {!uploadData && !uploadResults && (
                <div
                  className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                    dragActive ? 'border-knox-500 bg-knox-50' : 'border-slate-300'
                  }`}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                >
                  <UploadIcon className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                  <p className="text-slate-600 mb-2">Drop your contributions spreadsheet here</p>
                  <p className="text-sm text-slate-500 mb-4">
                    Format: Slack Name column + coin type columns (e.g., "Sacagawea Qty")
                  </p>
                  <input
                    type="file"
                    id="batch-upload"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileSelect(e.target.files[0])}
                  />
                  <label htmlFor="batch-upload" className="btn btn-primary cursor-pointer">
                    Select File
                  </label>
                </div>
              )}

              {error && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
                  <AlertCircle className="w-5 h-5" />
                  <span>{error}</span>
                </div>
              )}

              {uploadData && !uploadResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                    <div>
                      <p className="font-medium">{uploadData.filename}</p>
                      <p className="text-sm text-slate-500">
                        {uploadData.contributions.length} contributions from {uploadData.memberCount} members
                      </p>
                    </div>
                  </div>

                  {/* Matched Coins */}
                  {uploadData.matchedCoins?.length > 0 && (
                    <div className="p-4 border border-emerald-200 bg-emerald-50 rounded-lg">
                      <p className="text-sm font-medium text-emerald-800 mb-2 flex items-center gap-2">
                        <CheckCircle className="w-4 h-4" />
                        Matched Coin Types ({uploadData.matchedCoins.length})
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {uploadData.matchedCoins.map(ct => (
                          <span key={ct.name} className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-sm">
                            {ct.name} → {ct.matchedName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Unmatched Coins - Manual Mapping */}
                  {uploadData.unmatchedCoins?.length > 0 && (
                    <div className="p-4 border border-amber-200 bg-amber-50 rounded-lg">
                      <p className="text-sm font-medium text-amber-800 mb-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Map Unmatched Coin Types ({uploadData.unmatchedCoins.length})
                      </p>
                      <div className="space-y-3">
                        {uploadData.unmatchedCoins.map(ct => (
                          <div key={ct.name} className="flex items-center gap-3">
                            <span className="text-sm font-medium text-amber-800 w-28 truncate" title={ct.name}>
                              {ct.name}
                            </span>
                            <span className="text-slate-400">→</span>
                            <select
                              className="input text-sm flex-1"
                              value={coinMappings[ct.name] || ''}
                              onChange={(e) => setCoinMappings({
                                ...coinMappings,
                                [ct.name]: e.target.value ? parseInt(e.target.value) : null
                              })}
                            >
                              <option value="">+ Create new "{ct.name}"</option>
                              <optgroup label="Existing coin types">
                                {coinTypes.map(existing => (
                                  <option key={existing.coin_type_id} value={existing.coin_type_id}>
                                    {existing.name} {existing.short_code ? `(${existing.short_code})` : ''}
                                  </option>
                                ))}
                              </optgroup>
                            </select>
                            {coinMappings[ct.name] && (
                              <CheckCircle className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-amber-700 mt-3">
                        Select an existing coin type or leave as "Create new" to add it to your catalog.
                      </p>
                    </div>
                  )}

                  {/* Cost per Coin (optional) */}
                  {(uploadData.matchedCoins?.length > 0 || uploadData.unmatchedCoins?.length > 0) && (
                    <div className="p-4 border border-slate-200 bg-slate-50 rounded-lg">
                      <p className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                        <DollarSign className="w-4 h-4" />
                        Cost per Coin (optional - can set later)
                      </p>
                      <div className="space-y-2">
                        {[...(uploadData.matchedCoins || []), ...(uploadData.unmatchedCoins || [])].map(ct => (
                          <div key={ct.name} className="flex items-center gap-3">
                            <span className="text-sm text-slate-700 flex-1">{ct.matchedName || ct.name}</span>
                            <div className="relative w-28">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                              <input
                                type="number"
                                step="0.01"
                                className="input text-sm pl-7 text-right"
                                placeholder="0.00"
                                value={coinPrices[ct.matchedId || ct.name] || ''}
                                onChange={(e) => setCoinPrices({
                                  ...coinPrices,
                                  [ct.matchedId || ct.name]: e.target.value
                                })}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button onClick={resetUpload} className="btn btn-secondary flex-1">Cancel</button>
                    <button onClick={handleUpload} disabled={uploading} className="btn btn-primary flex-1">
                      {uploading ? 'Uploading...' : 'Import Contributions'}
                    </button>
                  </div>
                </div>
              )}

              {uploadResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-100 rounded-full">
                      <CheckCircle className="w-8 h-8 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">Upload Complete</h3>
                      <p className="text-slate-500">{uploadResults.imported} contributions imported</p>
                    </div>
                  </div>

                  {uploadResults.errors?.length > 0 && (
                    <div className="p-4 bg-amber-50 rounded-lg">
                      <p className="font-medium text-amber-800 mb-2">Warnings</p>
                      <ul className="text-sm text-amber-700 space-y-1">
                        {uploadResults.errors.map((err, i) => (
                          <li key={i}>• {err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button
                    onClick={() => { setShowUploadModal(false); resetUpload(); }}
                    className="btn btn-primary w-full"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
