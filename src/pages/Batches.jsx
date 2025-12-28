import { useState, useEffect, useCallback } from 'react'
import { Plus, Upload as UploadIcon, Calendar, Package, Users, X, Edit2, Trash2, ChevronDown, ChevronUp, FileSpreadsheet, CheckCircle, AlertCircle, DollarSign, Check, Scissors, RefreshCw } from 'lucide-react'
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
  const [showEditContribModal, setShowEditContribModal] = useState(false)
  const [editContributions, setEditContributions] = useState([])
  const [newContrib, setNewContrib] = useState({ userId: '', coinTypeId: '', quantity: 1 })
  
  // Split grading results
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [splitBatchId, setSplitBatchId] = useState(null)
  const [splitData, setSplitData] = useState([]) // [{ catalogId, coinName, total, graded, ungraded }]
  
  // Multi-batch import
  const [showMultiImportModal, setShowMultiImportModal] = useState(false)
  const [multiImportStep, setMultiImportStep] = useState(1) // 1=select sheets, 2=map coins, 3=importing, 4=done
  const [importFile, setImportFile] = useState(null)
  const [availableSheets, setAvailableSheets] = useState([])
  const [selectedSheets, setSelectedSheets] = useState({})
  const [sheetData, setSheetData] = useState({}) // { sheetName: { coinCodes: [], members: [], data: {} } }
  const [coinCodeMappings, setCoinCodeMappings] = useState({}) // { code: coinTypeId or 'new' }
  const [newCoinTypes, setNewCoinTypes] = useState({}) // { code: { name, shortCode } }
  const [importResults, setImportResults] = useState(null)
  
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
  const [gradingCosts, setGradingCosts] = useState({})
  const [originalPrices, setOriginalPrices] = useState({}) // Track original prices to detect changes
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

  // Update prices - only send coins with actual values entered
  const handleSavePrices = async () => {
    try {
      // Only include coins that have a positive value entered
      const pricesToSave = {}
      for (const [key, value] of Object.entries(coinPrices)) {
        // Skip empty values - don't update coins without a value
        if (value === '' || value === null || value === undefined) continue
        
        const num = parseFloat(value)
        // Only save positive numbers
        if (!isNaN(num) && num > 0) {
          pricesToSave[key] = num
        }
      }
      
      // Process grading costs (can be 0 for ungraded coins)
      const gradingToSave = {}
      for (const [key, value] of Object.entries(gradingCosts)) {
        if (value === '' || value === null || value === undefined) {
          gradingToSave[key] = 0
        } else {
          const num = parseFloat(value)
          if (!isNaN(num) && num >= 0) {
            gradingToSave[key] = num
          }
        }
      }
      
      // Make API call if there are prices or grading costs to save
      if (Object.keys(pricesToSave).length > 0 || Object.keys(gradingToSave).length > 0) {
        await api.put(`/batches?batchId=${selectedBatchId}`, { 
          coinPrices: pricesToSave,
          gradingCosts: gradingToSave
        })
      }
      
      setShowPricesModal(false)
      fetchBatchDetails(selectedBatchId)
    } catch (err) {
      alert('Error saving prices')
    }
  }

  // Edit contributions handlers
  const openEditContribModal = (batchId) => {
    setSelectedBatchId(batchId)
    // Create a copy of contributions for editing
    const contribCopy = (batchDetails?.contributions || []).map(c => ({
      ...c,
      originalQuantity: c.quantity
    }))
    setEditContributions(contribCopy)
    setShowEditContribModal(true)
  }

  const updateContribQuantity = (contribId, newQuantity) => {
    setEditContributions(prev => 
      prev.map(c => c.id === contribId ? { ...c, quantity: parseInt(newQuantity) || 0 } : c)
    )
  }

  const handleSaveContributions = async () => {
    try {
      // Find changed contributions
      const changed = editContributions.filter(c => c.quantity !== c.originalQuantity)
      
      for (const contrib of changed) {
        await api.put('/batches', { 
          contributionId: contrib.id, 
          quantity: contrib.quantity 
        })
      }
      
      setShowEditContribModal(false)
      fetchBatchDetails(selectedBatchId)
      fetchData() // Refresh batch list totals
    } catch (err) {
      alert('Error saving contributions')
    }
  }

  const handleDeleteContribution = async (contribId) => {
    if (!confirm('Delete this contribution?')) return
    try {
      await api.delete(`/batches?contributionId=${contribId}`)
      setEditContributions(prev => prev.filter(c => c.id !== contribId))
      fetchBatchDetails(selectedBatchId)
      fetchData()
    } catch (err) {
      alert('Error deleting contribution')
    }
  }

  const handleAddContribution = async () => {
    if (!newContrib.userId || !newContrib.coinTypeId || !newContrib.quantity) {
      alert('Please select user, coin type, and quantity')
      return
    }
    
    try {
      await api.post('/batches?action=addContribution', {
        batchId: selectedBatchId,
        userId: parseInt(newContrib.userId),
        coinTypeId: parseInt(newContrib.coinTypeId),
        quantity: parseInt(newContrib.quantity)
      })
      
      // Reset form
      setNewContrib({ userId: '', coinTypeId: '', quantity: 1 })
      
      // Fetch fresh batch details
      const res = await api.get(`/batches?batchId=${selectedBatchId}`)
      setBatchDetails(res.data)
      
      // Update editContributions with fresh data
      const contribCopy = (res.data?.contributions || []).map(c => ({
        ...c,
        originalQuantity: c.quantity
      }))
      setEditContributions(contribCopy)
      
      fetchData()
    } catch (err) {
      alert('Error adding contribution: ' + (err.response?.data?.error || err.message))
    }
  }

  // Multi-batch import functions
  const handleMultiImportFile = async (file) => {
    setImportFile(file)
    setError('')
    
    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      
      // Filter out "Coin Counts" sheets and empty sheets
      const sheets = workbook.SheetNames.filter(name => 
        !name.toLowerCase().includes('coin count') &&
        !name.toLowerCase().includes('coincount')
      )
      
      setAvailableSheets(sheets)
      
      // Parse each sheet to extract data
      const parsedData = {}
      sheets.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
        
        if (jsonData.length < 2) return // Skip empty sheets
        
        const headers = jsonData[0] || []
        const memberCol = headers.findIndex(h => 
          h && (h.toString().toLowerCase().includes('slack') || 
                h.toString().toLowerCase().includes('name') ||
                h.toString().toLowerCase().includes('member'))
        )
        
        if (memberCol === -1) return // Can't identify member column
        
        // Coin codes are all other columns after member column
        const coinCodes = headers.slice(memberCol + 1).filter(h => h && h.toString().trim())
        
        // Parse member contributions
        const contributions = {}
        jsonData.slice(1).forEach(row => {
          const memberName = row[memberCol]
          if (!memberName) return
          
          coinCodes.forEach((code, idx) => {
            const qty = parseFloat(row[memberCol + 1 + idx]) || 0
            if (qty > 0) {
              if (!contributions[code]) contributions[code] = []
              contributions[code].push({ member: memberName.toString(), quantity: qty })
            }
          })
        })
        
        parsedData[sheetName] = {
          coinCodes,
          contributions,
          totalMembers: new Set(jsonData.slice(1).map(r => r[memberCol]).filter(Boolean)).size
        }
      })
      
      setSheetData(parsedData)
      
      // Pre-select sheets that have data
      const preSelected = {}
      sheets.forEach(s => {
        if (parsedData[s]?.coinCodes?.length > 0) {
          preSelected[s] = true
        }
      })
      setSelectedSheets(preSelected)
      
      setMultiImportStep(1)
      setShowMultiImportModal(true)
    } catch (err) {
      setError('Error reading file: ' + err.message)
    }
  }

  const proceedToMapping = () => {
    // Collect all unique coin codes from selected sheets
    const allCodes = new Set()
    Object.entries(selectedSheets).forEach(([sheetName, isSelected]) => {
      if (isSelected && sheetData[sheetName]) {
        sheetData[sheetName].coinCodes.forEach(code => allCodes.add(code))
      }
    })
    
    // Auto-suggest mappings
    const mappings = {}
    const newTypes = {}
    allCodes.forEach(code => {
      const match = findBestMatch(code)
      if (match) {
        mappings[code] = match.coin_type_id
      } else {
        mappings[code] = 'new'
        newTypes[code] = { name: code, shortCode: code }
      }
    })
    
    setCoinCodeMappings(mappings)
    setNewCoinTypes(newTypes)
    setMultiImportStep(2)
  }

  const executeMultiImport = async () => {
    setMultiImportStep(3)
    setImportResults(null)
    
    try {
      // Build import payload
      const batchesToImport = []
      
      Object.entries(selectedSheets).forEach(([sheetName, isSelected]) => {
        if (!isSelected || !sheetData[sheetName]) return
        
        const sheet = sheetData[sheetName]
        const contributions = []
        
        Object.entries(sheet.contributions).forEach(([coinCode, members]) => {
          const mapping = coinCodeMappings[coinCode]
          if (!mapping) return
          
          members.forEach(({ member, quantity }) => {
            contributions.push({
              memberName: member,
              coinCode,
              coinTypeId: mapping === 'new' ? null : mapping,
              newCoinType: mapping === 'new' ? newCoinTypes[coinCode] : null,
              quantity
            })
          })
        })
        
        batchesToImport.push({
          batchName: sheetName,
          contributions
        })
      })
      
      const response = await api.post('/batches?action=bulkImport', {
        batches: batchesToImport,
        coinCodeMappings,
        newCoinTypes
      })
      
      setImportResults(response.data)
      setMultiImportStep(4)
      fetchData()
      fetchCoinTypes()
    } catch (err) {
      setError('Import failed: ' + (err.response?.data?.error || err.message))
      setMultiImportStep(2)
    }
  }

  const resetMultiImport = () => {
    setShowMultiImportModal(false)
    setMultiImportStep(1)
    setImportFile(null)
    setAvailableSheets([])
    setSelectedSheets({})
    setSheetData({})
    setCoinCodeMappings({})
    setNewCoinTypes({})
    setImportResults(null)
    setError('')
  }

  const fetchCoinTypes = async () => {
    try {
      const res = await api.get('/batches?action=coinTypes')
      setCoinTypes(res.data)
    } catch (error) {
      console.error('Error fetching coin types:', error)
    }
  }

  // Split grading results functions
  // This updates INVENTORY (batch_coins) only - contributions stay as original
  const openSplitModal = (batchId, batchCoins, contributions) => {
    setSplitBatchId(batchId)
    
    // Get total contributions per coin type (this is for reference/validation)
    const contribTotals = {}
    if (contributions && contributions.length > 0) {
      contributions.forEach(c => {
        if (!contribTotals[c.coin_type_id]) {
          contribTotals[c.coin_type_id] = 0
        }
        contribTotals[c.coin_type_id] += c.quantity
      })
    }
    
    // Group batch coins by catalog_id to pair graded/ungraded variants
    const coinGroups = {}
    batchCoins.forEach(bc => {
      const catalogId = bc.catalog_id || bc.short_code?.replace('-UNGRADED', '') || bc.coin_type_name.replace(' (Ungraded)', '')
      if (!coinGroups[catalogId]) {
        coinGroups[catalogId] = { graded: null, ungraded: null }
      }
      if (bc.is_ungraded) {
        coinGroups[catalogId].ungraded = bc
      } else {
        coinGroups[catalogId].graded = bc
      }
    })
    
    // Build split data from batch_coins (inventory)
    const data = Object.entries(coinGroups)
      .filter(([_, group]) => {
        // Include if graded coin type has contributions
        return group.graded && contribTotals[group.graded.coin_type_id] > 0
      })
      .map(([catalogId, group]) => {
        // Total coins = sum of contributions for this coin type
        const total = contribTotals[group.graded.coin_type_id] || 0
        // Current graded inventory (from batch_coins)
        const currentGraded = group.graded?.total_contributed || total
        // Current ungraded inventory (from batch_coins)
        const currentUngraded = group.ungraded?.total_contributed || 0
        
        return {
          catalogId,
          coinTypeId: group.graded?.coin_type_id,
          ungradedCoinTypeId: group.ungraded?.coin_type_id,
          coinName: group.graded?.coin_type_name,
          total, // Total coins from contributions (doesn't change)
          graded: currentGraded,
          ungraded: currentUngraded,
          originalGraded: currentGraded,
          originalUngraded: currentUngraded
        }
      })
    setSplitData(data)
    setShowSplitModal(true)
  }

  const updateSplitQuantity = (index, field, value) => {
    setSplitData(prev => {
      const updated = [...prev]
      const item = { ...updated[index] }
      // Remove leading zeros and parse - handle empty string as 0
      const cleanValue = value.toString().replace(/^0+/, '') || '0'
      const val = Math.max(0, parseInt(cleanValue) || 0)
      
      if (field === 'graded') {
        item.graded = Math.min(val, item.total)
        item.ungraded = item.total - item.graded
      } else {
        item.ungraded = Math.min(val, item.total)
        item.graded = item.total - item.ungraded
      }
      
      updated[index] = item
      return updated
    })
  }

  const handleSplitGradingResults = async () => {
    try {
      // Include all items where the split has changed from original
      const splits = splitData
        .filter(s => s.graded !== s.originalGraded || s.ungraded !== s.originalUngraded)
        .map(s => ({
          coinTypeId: s.coinTypeId,
          ungradedCoinTypeId: s.ungradedCoinTypeId,
          catalogId: s.catalogId,
          graded: s.graded,
          ungraded: s.ungraded
        }))
      
      if (splits.length === 0) {
        alert('No changes made')
        return
      }
      
      console.log('Sending split request:', { batchId: splitBatchId, splits })
      
      const response = await api.post('/batches?action=splitGradingResults', {
        batchId: splitBatchId,
        splits
      })
      
      console.log('Split response:', response.data)
      
      // Show results
      if (response.data.results) {
        const summary = response.data.results.map(r => 
          r.error 
            ? `${r.catalogId || r.coinTypeId}: ${r.error}` 
            : `${r.catalogId}: ${r.totalGraded} graded, ${r.totalUngraded} ungraded`
        ).join('\n')
        alert('Split updated!\n\n' + summary)
      }
      
      setShowSplitModal(false)
      setSplitData([])
      fetchData()
      fetchCoinTypes()
      
      // Refresh batch details if expanded
      if (expandedBatch === splitBatchId) {
        const res = await api.get(`/batches?action=details&batchId=${splitBatchId}`)
        setBatchDetails(res.data)
      }
    } catch (error) {
      console.error('Error splitting grading results:', error)
      alert('Error: ' + (error.response?.data?.error || error.message))
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

      // Find coin columns - try two formats:
      // Format 1: Columns with "Qty" in header (e.g., "Sacagawea Qty")
      // Format 2: Columns with coin codes directly (e.g., "25SG1", "25EALE")
      let coinColumns = []
      
      // First try Format 1: "Qty" columns
      headers.forEach((h, idx) => {
        if (idx === memberColIdx) return
        const headerStr = String(h).toLowerCase()
        if (headerStr.includes('qty') || headerStr.includes('quantity')) {
          let coinName = String(h).replace(/\s*qty\s*/i, '').replace(/\s*quantity\s*/i, '').trim()
          if (coinName) {
            coinColumns.push({ idx, name: coinName })
          }
        }
      })

      // If no "Qty" columns found, try Format 2: direct coin codes
      if (coinColumns.length === 0) {
        headers.forEach((h, idx) => {
          if (idx === memberColIdx) return
          const headerStr = String(h).trim()
          // Skip empty headers and common non-coin columns
          if (!headerStr || 
              headerStr.toLowerCase() === 'total' ||
              headerStr.toLowerCase() === 'notes' ||
              headerStr.toLowerCase() === 'email') return
          
          // Treat this column as a coin code
          coinColumns.push({ idx, name: headerStr, isCode: true })
        })
      }

      if (coinColumns.length === 0) {
        setError('Could not find coin columns. Use either "Coin Name Qty" headers or coin codes like "25SG1"')
        return
      }

      // Match coin columns against known coin types
      const matchedCoins = []
      const unmatchedCoins = []
      
      for (const col of coinColumns) {
        // Try matching by name, short_code, or catalog_id
        const match = coinTypes.find(ct => 
          ct.name.toLowerCase() === col.name.toLowerCase() ||
          ct.short_code?.toLowerCase() === col.name.toLowerCase() ||
          ct.catalog_id?.toLowerCase() === col.name.toLowerCase()
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
        <div className="flex items-center gap-3">
          <label className="btn btn-secondary gap-2 cursor-pointer">
            <UploadIcon className="w-4 h-4" />
            Import Batches
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleMultiImportFile(e.target.files[0])}
            />
          </label>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary gap-2">
            <Plus className="w-4 h-4" />
            New Batch
          </button>
        </div>
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
                  <div className="px-6 py-3 bg-slate-50 flex flex-wrap gap-2">
                    <button onClick={() => openUploadModal(batch.batch_id)} className="btn btn-secondary btn-sm gap-1">
                      <UploadIcon className="w-4 h-4" /> Upload Contributions
                    </button>
                    <button 
                      onClick={() => openSplitModal(batch.batch_id, batchDetails.coins || [], batchDetails.contributions || [])} 
                      className="btn btn-secondary btn-sm gap-1"
                      disabled={!batchDetails.contributions?.length}
                      title={!batchDetails.contributions?.length ? "Upload contributions first" : "Record grading results (how many graded vs ungraded)"}
                    >
                      <Scissors className="w-4 h-4" /> Grading Results
                    </button>
                    {/* Show cleanup button if there are ungraded contributions (from old split logic) */}
                    {batchDetails.contributions?.some(c => c.is_ungraded || c.coin_type_name?.includes('(Ungraded)')) && (
                      <button 
                        onClick={async () => {
                          if (!confirm('This will merge ungraded contribution entries back into the main coin type. Continue?')) return;
                          try {
                            const res = await api.post('/batches?action=cleanupUngradedContributions', { batchId: batch.batch_id });
                            alert(res.data.message);
                            fetchBatchDetails(batch.batch_id);
                          } catch (err) {
                            alert('Error cleaning up: ' + (err.response?.data?.error || err.message));
                          }
                        }}
                        className="btn btn-secondary btn-sm gap-1 text-amber-600 hover:bg-amber-50"
                        title="Merge ungraded contribution entries back into graded (fixes old data)"
                      >
                        <RefreshCw className="w-4 h-4" /> Fix Split Data
                      </button>
                    )}
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
                            // Initialize prices and grading costs from current batch coins
                            const prices = {}
                            const grading = {}
                            batchDetails.coins.forEach(c => {
                              const key = String(c.coin_type_id)
                              // Get raw value and ensure it's a number
                              const rawVal = c.cost_per_coin
                              const numVal = typeof rawVal === 'number' ? rawVal : parseFloat(rawVal)
                              // Only show as value if it's a valid positive number
                              if (!isNaN(numVal) && numVal > 0) {
                                prices[key] = String(numVal) // Store as string for text input
                              } else {
                                prices[key] = ''
                              }
                              // Get grading cost
                              const gradingVal = c.grading_cost_per_coin
                              const gradingNum = typeof gradingVal === 'number' ? gradingVal : parseFloat(gradingVal)
                              if (!isNaN(gradingNum) && gradingNum > 0) {
                                grading[key] = String(gradingNum)
                              } else {
                                grading[key] = ''
                              }
                            })
                            setCoinPrices(prices)
                            setGradingCosts(grading)
                            setOriginalPrices({...prices})
                            setSelectedBatchId(expandedBatch)
                            setShowPricesModal(true)
                          }}
                          className="text-sm text-knox-600 hover:underline"
                        >
                          Edit Prices
                        </button>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {batchDetails.coins.map(coin => {
                          const price = parseFloat(coin.cost_per_coin)
                          const gradingCost = parseFloat(coin.grading_cost_per_coin) || 0
                          const hasValidPrice = coin.cost_per_coin !== null && coin.cost_per_coin !== undefined && !isNaN(price) && price > 0
                          const totalCost = (hasValidPrice ? price : 0) + gradingCost
                          return (
                            <div key={coin.id} className="p-3 bg-slate-50 rounded-lg">
                              <div className="flex items-center justify-between">
                                <p className="font-medium text-sm">{coin.coin_type_name}</p>
                                {coin.is_ungraded && (
                                  <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">UG</span>
                                )}
                              </div>
                              <p className="text-xs text-slate-500">{coin.total_contributed} coins</p>
                              <div className="mt-1 text-sm">
                                {hasValidPrice ? (
                                  <div>
                                    <span className="text-emerald-600 font-medium">${price.toFixed(2)}</span>
                                    {gradingCost > 0 && (
                                      <span className="text-slate-500 text-xs ml-1">+ ${gradingCost.toFixed(2)} grading</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-amber-600">No price set</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Contributions by Coin Type */}
                  {batchDetails.contributions?.length > 0 ? (
                    <div className="px-6 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="font-medium text-slate-900">Contributions</h4>
                        <button
                          onClick={() => openEditContribModal(batch.batch_id)}
                          className="text-sm text-knox-600 hover:text-knox-700 flex items-center gap-1"
                        >
                          <Edit2 className="w-4 h-4" />
                          Edit
                        </button>
                      </div>
                      <div className="space-y-3">
                        {Object.entries(groupContributions(batchDetails.contributions)).map(([coinType, data]) => (
                          <div key={coinType} className="border rounded-lg overflow-hidden">
                            <div className="bg-slate-100 px-4 py-2 flex items-center justify-between">
                              <span className="font-medium text-slate-800">{coinType}</span>
                              <span className="text-sm text-slate-500">{data.total} coins</span>
                            </div>
                            <div className="divide-y">
                              {data.members.map(contrib => (
                                <div key={contrib.id} className="px-4 py-2 flex items-center justify-between hover:bg-slate-50">
                                  <span className="text-slate-700">{contrib.full_name || contrib.username}</span>
                                  <div className="flex items-center gap-4">
                                    <span className="font-medium text-slate-900 w-12 text-right">{contrib.quantity}</span>
                                    <span className="text-slate-400 w-16 text-right text-sm">
                                      {((contrib.quantity / data.total) * 100).toFixed(1)}%
                                    </span>
                                    <div className="w-24 bg-slate-200 rounded-full h-2">
                                      <div 
                                        className="bg-knox-500 h-2 rounded-full" 
                                        style={{ width: `${(contrib.quantity / data.total) * 100}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Costs per Coin</h2>
              <button onClick={() => setShowPricesModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
              {batchDetails.coins?.map(coin => {
                const key = String(coin.coin_type_id)
                const isUngraded = coin.is_ungraded
                return (
                  <div key={coin.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="font-medium">{coin.coin_type_name}</p>
                        <p className="text-xs text-slate-500">{coin.total_contributed} coins</p>
                      </div>
                      {isUngraded && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded">Ungraded</span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Coin Cost</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*\.?[0-9]*"
                            className="input pl-7 text-right"
                            placeholder="—"
                            value={typeof coinPrices[key] === 'object' ? '' : (coinPrices[key] || '')}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9.]/g, '')
                              setCoinPrices({
                                ...coinPrices,
                                [key]: val
                              })
                            }}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">
                          Grading Cost
                        </label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            pattern="[0-9]*\.?[0-9]*"
                            className="input pl-7 text-right"
                            placeholder="—"
                            value={gradingCosts[key] || ''}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9.]/g, '')
                              setGradingCosts({
                                ...gradingCosts,
                                [key]: val
                              })
                            }}
                          />
                        </div>
                      </div>
                    </div>
                    {(coinPrices[key] || gradingCosts[key]) && (
                      <div className="mt-2 pt-2 border-t text-xs text-slate-500">
                        Total cost: ${((parseFloat(coinPrices[key]) || 0) + (parseFloat(gradingCosts[key]) || 0)).toFixed(2)}/coin
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <button onClick={() => setShowPricesModal(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button onClick={handleSavePrices} className="btn btn-primary flex-1">
                Save Costs
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
                    Format: Slack Name column + coin codes (e.g., 25SG1, 25EALE)
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

      {/* Edit Contributions Modal */}
      {showEditContribModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Contributions</h2>
              <button onClick={() => setShowEditContribModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {/* Add New Contribution */}
              <div className="mb-6 p-4 bg-knox-50 rounded-lg border border-knox-200">
                <h4 className="font-medium text-slate-900 mb-3 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add Contribution
                </h4>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label text-xs">Member</label>
                    <select
                      className="input text-sm"
                      value={newContrib.userId}
                      onChange={(e) => setNewContrib({ ...newContrib, userId: e.target.value })}
                    >
                      <option value="">Select member...</option>
                      {users.map(u => (
                        <option key={u.user_id} value={u.user_id}>
                          {u.full_name || u.username}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Coin Type</label>
                    <select
                      className="input text-sm"
                      value={newContrib.coinTypeId}
                      onChange={(e) => setNewContrib({ ...newContrib, coinTypeId: e.target.value })}
                    >
                      <option value="">Select coin...</option>
                      {coinTypes.map(ct => (
                        <option key={ct.coin_type_id} value={ct.coin_type_id}>
                          {ct.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">Quantity</label>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        className="input text-sm flex-1"
                        value={newContrib.quantity}
                        onChange={(e) => setNewContrib({ ...newContrib, quantity: e.target.value })}
                      />
                      <button
                        onClick={handleAddContribution}
                        className="btn btn-primary text-sm px-3"
                        disabled={!newContrib.userId || !newContrib.coinTypeId}
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Existing Contributions */}
              {editContributions.length === 0 ? (
                <p className="text-center text-slate-500 py-8">No contributions yet</p>
              ) : (
                <div className="space-y-4">
                  {Object.entries(
                    editContributions.reduce((acc, c) => {
                      const coinName = c.coin_type_name || 'Unknown'
                      if (!acc[coinName]) acc[coinName] = []
                      acc[coinName].push(c)
                      return acc
                    }, {})
                  ).map(([coinType, contribs]) => (
                    <div key={coinType} className="border rounded-lg overflow-hidden">
                      <div className="bg-slate-50 px-4 py-2 font-medium text-slate-700 text-sm">
                        {coinType}
                      </div>
                      <div className="divide-y">
                        {contribs.map(contrib => (
                          <div key={contrib.id} className="px-4 py-3 flex items-center gap-4">
                            <div className="flex-1">
                              <p className="font-medium text-slate-900">
                                {contrib.full_name || contrib.username}
                              </p>
                              <p className="text-xs text-slate-500">@{contrib.username}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min="0"
                                className="input w-20 text-center"
                                value={contrib.quantity}
                                onChange={(e) => updateContribQuantity(contrib.id, e.target.value)}
                              />
                              <button
                                onClick={() => handleDeleteContribution(contrib.id)}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete contribution"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t bg-slate-50 flex gap-3">
              <button 
                onClick={() => setShowEditContribModal(false)} 
                className="btn btn-secondary flex-1"
              >
                Cancel
              </button>
              <button 
                onClick={handleSaveContributions} 
                className="btn btn-primary flex-1"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Import Modal */}
      {showMultiImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl mx-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Import Batches</h2>
                <p className="text-sm text-slate-500">
                  {multiImportStep === 1 && 'Select sheets to import as batches'}
                  {multiImportStep === 2 && 'Map coin codes to coin types'}
                  {multiImportStep === 3 && 'Importing...'}
                  {multiImportStep === 4 && 'Import complete'}
                </p>
              </div>
              <button onClick={resetMultiImport} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step indicators */}
            <div className="px-6 py-3 bg-slate-50 border-b">
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4].map(step => (
                  <div key={step} className="flex items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                      multiImportStep >= step 
                        ? 'bg-knox-600 text-white' 
                        : 'bg-slate-200 text-slate-500'
                    }`}>
                      {multiImportStep > step ? <Check className="w-4 h-4" /> : step}
                    </div>
                    {step < 4 && <div className={`w-12 h-1 mx-1 ${multiImportStep > step ? 'bg-knox-600' : 'bg-slate-200'}`} />}
                  </div>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Step 1: Select Sheets */}
              {multiImportStep === 1 && (
                <div className="space-y-4">
                  <p className="text-slate-600">
                    Found {availableSheets.length} sheet(s) in <span className="font-medium">{importFile?.name}</span>
                  </p>
                  <div className="space-y-2">
                    {availableSheets.map(sheetName => {
                      const data = sheetData[sheetName]
                      const hasData = data?.coinCodes?.length > 0
                      return (
                        <label 
                          key={sheetName}
                          className={`flex items-center gap-3 p-4 border rounded-lg cursor-pointer transition-colors ${
                            selectedSheets[sheetName] ? 'border-knox-500 bg-knox-50' : 'hover:bg-slate-50'
                          } ${!hasData ? 'opacity-50' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={!!selectedSheets[sheetName]}
                            disabled={!hasData}
                            onChange={(e) => setSelectedSheets(prev => ({
                              ...prev,
                              [sheetName]: e.target.checked
                            }))}
                            className="rounded border-slate-300 text-knox-600 focus:ring-knox-500"
                          />
                          <div className="flex-1">
                            <p className="font-medium text-slate-900">{sheetName}</p>
                            {hasData ? (
                              <p className="text-sm text-slate-500">
                                {data.coinCodes.length} coin type(s): {data.coinCodes.slice(0, 5).join(', ')}
                                {data.coinCodes.length > 5 && ` +${data.coinCodes.length - 5} more`}
                                {' • '}{data.totalMembers} member(s)
                              </p>
                            ) : (
                              <p className="text-sm text-slate-400">No contribution data found</p>
                            )}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Step 2: Map Coin Codes */}
              {multiImportStep === 2 && (
                <div className="space-y-4">
                  <p className="text-slate-600">
                    Map each coin code to an existing coin type or create a new one.
                  </p>
                  <div className="space-y-3">
                    {Object.keys(coinCodeMappings).map(code => (
                      <div key={code} className="p-4 border rounded-lg">
                        <div className="flex items-start gap-4">
                          <div className="flex-shrink-0 w-32">
                            <p className="font-mono font-medium text-slate-900 bg-slate-100 px-2 py-1 rounded">
                              {code}
                            </p>
                          </div>
                          <div className="flex-1 space-y-2">
                            <select
                              className="input"
                              value={coinCodeMappings[code]}
                              onChange={(e) => {
                                const val = e.target.value
                                setCoinCodeMappings(prev => ({ ...prev, [code]: val }))
                                if (val === 'new' && !newCoinTypes[code]) {
                                  setNewCoinTypes(prev => ({ ...prev, [code]: { name: code, shortCode: code } }))
                                }
                              }}
                            >
                              <option value="new">➕ Create new coin type</option>
                              {coinTypes.map(ct => (
                                <option key={ct.coin_type_id} value={ct.coin_type_id}>
                                  {ct.name} {ct.short_code ? `(${ct.short_code})` : ''}
                                </option>
                              ))}
                            </select>
                            
                            {coinCodeMappings[code] === 'new' && (
                              <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-slate-50 rounded-lg">
                                <div>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">
                                    Full Name
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="e.g., 2023 Silver Eagle"
                                    className="input text-sm"
                                    value={newCoinTypes[code]?.name || ''}
                                    onChange={(e) => setNewCoinTypes(prev => ({
                                      ...prev,
                                      [code]: { ...prev[code], name: e.target.value }
                                    }))}
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs font-medium text-slate-600 mb-1">
                                    Short Code
                                  </label>
                                  <input
                                    type="text"
                                    placeholder="e.g., 23XE"
                                    className="input text-sm"
                                    value={newCoinTypes[code]?.shortCode || ''}
                                    onChange={(e) => setNewCoinTypes(prev => ({
                                      ...prev,
                                      [code]: { ...prev[code], shortCode: e.target.value }
                                    }))}
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Importing */}
              {multiImportStep === 3 && (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-knox-600 mb-4"></div>
                  <p className="text-slate-600">Importing batches and contributions...</p>
                </div>
              )}

              {/* Step 4: Complete */}
              {multiImportStep === 4 && importResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <CheckCircle className="w-6 h-6 text-emerald-600" />
                    <div>
                      <p className="font-medium text-emerald-800">Import completed successfully!</p>
                      <p className="text-sm text-emerald-600">
                        {importResults.batchesCreated} batch(es) created • {importResults.contributionsCreated} contribution(s) added
                        {importResults.coinTypesCreated > 0 && ` • ${importResults.coinTypesCreated} new coin type(s)`}
                      </p>
                    </div>
                  </div>
                  
                  {importResults.errors?.length > 0 && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="font-medium text-amber-800 mb-2">Some issues occurred:</p>
                      <ul className="text-sm text-amber-700 list-disc list-inside">
                        {importResults.errors.map((err, idx) => (
                          <li key={idx}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t bg-slate-50 flex justify-between">
              <button
                onClick={resetMultiImport}
                className="btn btn-secondary"
              >
                {multiImportStep === 4 ? 'Close' : 'Cancel'}
              </button>
              <div className="flex gap-3">
                {multiImportStep === 2 && (
                  <button
                    onClick={() => setMultiImportStep(1)}
                    className="btn btn-secondary"
                  >
                    Back
                  </button>
                )}
                {multiImportStep === 1 && (
                  <button
                    onClick={proceedToMapping}
                    disabled={Object.values(selectedSheets).filter(Boolean).length === 0}
                    className="btn btn-primary"
                  >
                    Continue
                  </button>
                )}
                {multiImportStep === 2 && (
                  <button
                    onClick={executeMultiImport}
                    className="btn btn-primary"
                  >
                    Import {Object.values(selectedSheets).filter(Boolean).length} Batch(es)
                  </button>
                )}
                {multiImportStep === 4 && (
                  <button
                    onClick={resetMultiImport}
                    className="btn btn-primary"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Split Grading Results Modal */}
      {showSplitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Grading Results</h2>
                <p className="text-sm text-slate-500">Record how many coins came back graded vs ungraded</p>
              </div>
              <button onClick={() => setShowSplitModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {splitData.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-slate-500 mb-2">No coin types with contributions</p>
                  <p className="text-sm text-slate-400">Upload contributions first, then record grading results here.</p>
                </div>
              ) : (
                splitData.map((item, index) => (
                  <div key={item.catalogId} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-medium text-slate-900">{item.coinName}</p>
                        <p className="text-sm text-slate-500 font-mono">{item.catalogId}</p>
                      </div>
                      <span className="text-sm text-slate-600">Total: {item.total} coins</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-emerald-700 mb-1">
                          Graded
                          {item.originalGraded !== item.total && (
                            <span className="font-normal text-slate-400 ml-2">was {item.originalGraded}</span>
                          )}
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={item.total}
                          className="input"
                          value={item.graded}
                          onChange={(e) => updateSplitQuantity(index, 'graded', e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-amber-700 mb-1">
                          Ungraded
                          {item.originalUngraded > 0 && (
                            <span className="font-normal text-slate-400 ml-2">was {item.originalUngraded}</span>
                          )}
                        </label>
                        <input
                          type="number"
                          min="0"
                          max={item.total}
                          className="input"
                          value={item.ungraded}
                          onChange={(e) => updateSplitQuantity(index, 'ungraded', e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                    </div>
                    {item.ungraded !== item.originalUngraded && item.ungraded > 0 && item.originalUngraded === 0 && (
                      <p className="text-xs text-amber-600 mt-2">
                        Will create "{item.coinName} (Ungraded)" coin type
                      </p>
                    )}
                  </div>
                ))
              )}
              
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  <strong>How it works:</strong> This records inventory (how many graded vs ungraded came back). 
                  Payouts are calculated based on each contributor's original share % applied to ALL sales from this batch.
                  Set different costs for graded vs ungraded coins in "Edit Prices".
                </p>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t bg-slate-50 flex gap-3">
              <button onClick={() => setShowSplitModal(false)} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button 
                onClick={handleSplitGradingResults} 
                className="btn btn-primary flex-1"
                disabled={!splitData.some(s => s.graded !== s.originalGraded || s.ungraded !== s.originalUngraded)}
              >
                Save Grading Results
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
