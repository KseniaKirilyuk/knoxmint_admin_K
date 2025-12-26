import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'
import { User, Lock, Database, Zap, Coins, Plus, Upload as UploadIcon, X, Edit2, Trash2, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../lib/api'

export default function Settings() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('coins')
  const [passwords, setPasswords] = useState({
    current: '',
    new: '',
    confirm: ''
  })
  const [message, setMessage] = useState({ type: '', text: '' })
  const [loading, setLoading] = useState(false)

  // Coin types state
  const [coinTypes, setCoinTypes] = useState([])
  const [loadingCoins, setLoadingCoins] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [editingCoin, setEditingCoin] = useState(null)
  const [coinForm, setCoinForm] = useState({ name: '', catalogId: '', description: '', createBoth: true, isUngraded: false })
  const [uploadData, setUploadData] = useState(null)
  const [uploadResults, setUploadResults] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [uploadError, setUploadError] = useState('')

  useEffect(() => {
    if (activeTab === 'coins') {
      fetchCoinTypes()
    }
  }, [activeTab])

  const fetchCoinTypes = async () => {
    setLoadingCoins(true)
    try {
      const res = await api.get('/batches?action=coinTypes')
      setCoinTypes(res.data)
    } catch (error) {
      console.error('Error fetching coin types:', error)
    } finally {
      setLoadingCoins(false)
    }
  }

  const handleAddCoin = async (e) => {
    e.preventDefault()
    try {
      await api.post('/batches', { 
        action: 'addCoinType', 
        catalogId: coinForm.catalogId,
        name: coinForm.name || coinForm.catalogId,
        shortCode: coinForm.catalogId,
        description: coinForm.description,
        createBoth: coinForm.createBoth,
        isUngraded: coinForm.isUngraded
      })
      setShowAddModal(false)
      setCoinForm({ name: '', catalogId: '', description: '', createBoth: true, isUngraded: false })
      fetchCoinTypes()
    } catch (error) {
      alert(error.response?.data?.error || 'Error adding coin type')
    }
  }

  const openEditModal = (coin) => {
    setEditingCoin(coin)
    setCoinForm({
      name: coin.name || '',
      catalogId: coin.catalog_id || coin.short_code || '',
      description: coin.description || '',
      createBoth: false,
      isUngraded: coin.is_ungraded || false
    })
  }

  const handleEditCoin = async (e) => {
    e.preventDefault()
    try {
      await api.post('/batches', { 
        action: 'updateCoinType', 
        coinTypeId: editingCoin.coin_type_id,
        name: coinForm.name,
        catalogId: coinForm.catalogId,
        shortCode: coinForm.catalogId, // Keep short_code in sync with catalog_id
        description: coinForm.description,
        isUngraded: coinForm.isUngraded
      })
      setEditingCoin(null)
      setCoinForm({ name: '', catalogId: '', description: '', createBoth: true, isUngraded: false })
      fetchCoinTypes()
    } catch (error) {
      alert(error.response?.data?.error || 'Error updating coin type')
    }
  }

  const handleDeleteCoin = async (coinTypeId, coinName) => {
    if (!confirm(`Delete "${coinName}"? This cannot be undone.`)) return
    
    try {
      await api.post('/batches', { action: 'deleteCoinType', coinTypeId })
      fetchCoinTypes()
    } catch (error) {
      alert(error.response?.data?.error || 'Error deleting coin type')
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
    setUploadError('')
    setUploadResults(null)

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

      if (rows.length < 2) {
        setUploadError('Spreadsheet appears to be empty')
        return
      }

      const headers = rows[0].map(h => String(h).toLowerCase().trim())
      const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('coin'))
      const catalogIdx = headers.findIndex(h => h.includes('catalog') || h.includes('sku') || h.includes('code'))
      const originalPriceIdx = headers.findIndex(h => h.includes('original') || h.includes('purchase'))
      const currentPriceIdx = headers.findIndex(h => h.includes('current') || (h.includes('price') && !h.includes('original') && !h.includes('purchase')))

      if (nameIdx === -1) {
        setUploadError('Could not find coin name column')
        return
      }

      const coins = []
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]
        const name = String(row[nameIdx] || '').trim()
        if (!name) continue

        coins.push({
          name,
          catalogNumber: catalogIdx >= 0 ? String(row[catalogIdx] || '').trim() : '',
          originalPrice: originalPriceIdx >= 0 ? parseFloat(row[originalPriceIdx]) || null : null,
          currentPrice: currentPriceIdx >= 0 ? parseFloat(row[currentPriceIdx]) || null : null
        })
      }

      setUploadData({ filename: file.name, coins })
    } catch (err) {
      setUploadError('Error parsing file: ' + err.message)
    }
  }

  const handleUploadCoins = async () => {
    if (!uploadData) return
    setUploading(true)
    setUploadError('')

    let imported = 0
    let errors = []

    for (const coin of uploadData.coins) {
      try {
        await api.post('/batches', {
          action: 'addCoinType',
          name: coin.name,
          mintCatalogNumber: coin.catalogNumber,
          originalPrice: coin.originalPrice,
          currentPrice: coin.currentPrice,
          shortCode: coin.name.substring(0, 10).toUpperCase().replace(/\s+/g, '')
        })
        imported++
      } catch (err) {
        if (err.response?.data?.error?.includes('Already exists')) {
          // Skip duplicates silently
        } else {
          errors.push(`${coin.name}: ${err.response?.data?.error || err.message}`)
        }
      }
    }

    setUploadResults({ imported, errors: errors.slice(0, 5) })
    setUploading(false)
    fetchCoinTypes()
  }

  const resetUpload = () => {
    setUploadData(null)
    setUploadResults(null)
    setUploadError('')
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    
    if (passwords.new !== passwords.confirm) {
      setMessage({ type: 'error', text: 'New passwords do not match' })
      return
    }

    if (passwords.new.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' })
      return
    }

    setLoading(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.new
      })
      setMessage({ type: 'success', text: 'Password updated successfully' })
      setPasswords({ current: '', new: '', confirm: '' })
    } catch (error) {
      setMessage({ 
        type: 'error', 
        text: error.response?.data?.error || 'Error updating password' 
      })
    } finally {
      setLoading(false)
    }
  }

  const tabs = [
    { id: 'coins', label: 'Coin Types', icon: Coins },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'integrations', label: 'Integrations', icon: Zap }
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">Manage your account and application settings</p>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0">
          <nav className="space-y-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-knox-50 text-knox-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <tab.icon className="w-5 h-5" />
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1">
          {activeTab === 'coins' && (
            <div className="card p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold">Coin Types</h2>
                  <p className="text-sm text-slate-500">Manage your coin catalog</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowUploadModal(true)} className="btn btn-secondary gap-2">
                    <UploadIcon className="w-4 h-4" /> Upload
                  </button>
                  <button onClick={() => setShowAddModal(true)} className="btn btn-primary gap-2">
                    <Plus className="w-4 h-4" /> Add Coin
                  </button>
                </div>
              </div>

              {loadingCoins ? (
                <div className="flex items-center justify-center h-32">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-knox-600"></div>
                </div>
              ) : coinTypes.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <Coins className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                  <p>No coin types yet. Upload a spreadsheet or add manually.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Name</th>
                        <th className="table-header">Catalog ID</th>
                        <th className="table-header">Type</th>
                        <th className="table-header w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {coinTypes.map((coin) => (
                        <tr key={coin.coin_type_id} className="hover:bg-slate-50">
                          <td className="table-cell font-medium">{coin.name}</td>
                          <td className="table-cell">
                            <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-mono">
                              {coin.catalog_id || coin.short_code || '-'}
                            </span>
                          </td>
                          <td className="table-cell">
                            {coin.is_ungraded ? (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs">
                                Ungraded
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">
                                Graded
                              </span>
                            )}
                          </td>
                          <td className="table-cell">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => openEditModal(coin)}
                                className="p-1.5 text-slate-400 hover:text-knox-600 hover:bg-knox-50 rounded"
                                title="Edit"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteCoin(coin.coin_type_id, coin.name)}
                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Profile Information</h2>
              <div className="space-y-4 max-w-md">
                <div>
                  <label className="label">Username</label>
                  <input
                    type="text"
                    className="input bg-slate-50"
                    value={user?.username || ''}
                    disabled
                  />
                </div>
                <div>
                  <label className="label">Full Name</label>
                  <input
                    type="text"
                    className="input"
                    defaultValue={user?.fullName || ''}
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input"
                    defaultValue={user?.email || ''}
                  />
                </div>
                <div>
                  <label className="label">Role</label>
                  <input
                    type="text"
                    className="input bg-slate-50 capitalize"
                    value={user?.role || ''}
                    disabled
                  />
                </div>
                <button className="btn btn-primary mt-4">
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Change Password</h2>
              
              {message.text && (
                <div className={`mb-4 p-3 rounded-lg text-sm ${
                  message.type === 'error' 
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  {message.text}
                </div>
              )}

              <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
                <div>
                  <label className="label">Current Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwords.current}
                    onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">New Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwords.new}
                    onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="label">Confirm New Password</label>
                  <input
                    type="password"
                    className="input"
                    value={passwords.confirm}
                    onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
                    required
                  />
                </div>
                <button 
                  type="submit" 
                  className="btn btn-primary mt-4"
                  disabled={loading}
                >
                  {loading ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-6">Integrations</h2>
              
              <div className="space-y-4">
                {/* eBay Integration */}
                <div className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 font-bold text-sm">eBay</span>
                      </div>
                      <div>
                        <h3 className="font-medium">eBay API</h3>
                        <p className="text-sm text-slate-500">Sync sales automatically</p>
                      </div>
                    </div>
                    <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-xs font-medium">
                      Phase 2
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 mb-3">
                    Connect your eBay seller account to automatically import sales transactions.
                  </p>
                  <button className="btn btn-secondary" disabled>
                    Configure (Coming Soon)
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Coin Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Add Coin Type</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddCoin} className="p-6 space-y-4">
              <div>
                <label className="label">US Mint Catalog ID *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., 23XH, 25EALE"
                  value={coinForm.catalogId}
                  onChange={(e) => setCoinForm({ ...coinForm, catalogId: e.target.value.toUpperCase() })}
                  required
                />
                <p className="text-xs text-slate-500 mt-1">This is the code from the US Mint website</p>
              </div>
              <div>
                <label className="label">Display Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., 2023 Peace Dollar"
                  value={coinForm.name}
                  onChange={(e) => setCoinForm({ ...coinForm, name: e.target.value })}
                />
                <p className="text-xs text-slate-500 mt-1">Optional - defaults to Catalog ID if blank</p>
              </div>
              <div>
                <label className="label">Description</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Optional description"
                  value={coinForm.description}
                  onChange={(e) => setCoinForm({ ...coinForm, description: e.target.value })}
                />
              </div>
              <div className="bg-slate-50 rounded-lg p-4 space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={coinForm.createBoth}
                    onChange={(e) => setCoinForm({ ...coinForm, createBoth: e.target.checked })}
                    className="rounded border-slate-300 text-knox-600 focus:ring-knox-500"
                  />
                  <div>
                    <p className="font-medium text-slate-900">Create both graded & ungraded variants</p>
                    <p className="text-xs text-slate-500">Creates {coinForm.catalogId || 'CODE'} and {coinForm.catalogId || 'CODE'}-UNGRADED</p>
                  </div>
                </label>
                
                {!coinForm.createBoth && (
                  <div className="pt-2 border-t border-slate-200">
                    <p className="text-sm font-medium text-slate-700 mb-2">Coin Type:</p>
                    <div className="flex gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="coinType"
                          checked={!coinForm.isUngraded}
                          onChange={() => setCoinForm({ ...coinForm, isUngraded: false })}
                          className="text-knox-600 focus:ring-knox-500"
                        />
                        <span className="text-sm">Graded</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="coinType"
                          checked={coinForm.isUngraded}
                          onChange={() => setCoinForm({ ...coinForm, isUngraded: true })}
                          className="text-knox-600 focus:ring-knox-500"
                        />
                        <span className="text-sm">Ungraded</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  Add Coin{coinForm.createBoth ? 's' : ''}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Coin Modal */}
      {editingCoin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Edit Coin Type</h2>
              <button onClick={() => setEditingCoin(null)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleEditCoin} className="p-6 space-y-4">
              <div>
                <label className="label">Display Name *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., 2023 Peace Dollar"
                  value={coinForm.name}
                  onChange={(e) => setCoinForm({ ...coinForm, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label">Catalog ID</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., 23XH"
                  value={coinForm.catalogId}
                  onChange={(e) => setCoinForm({ ...coinForm, catalogId: e.target.value.toUpperCase() })}
                />
                <p className="text-xs text-slate-500 mt-1">US Mint catalog code</p>
              </div>
              <div>
                <label className="label">Description</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Optional description"
                  value={coinForm.description}
                  onChange={(e) => setCoinForm({ ...coinForm, description: e.target.value })}
                />
              </div>
              <div className="bg-slate-50 rounded-lg p-4">
                <p className="text-sm font-medium text-slate-700 mb-2">Coin Type:</p>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editCoinType"
                      checked={!coinForm.isUngraded}
                      onChange={() => setCoinForm({ ...coinForm, isUngraded: false })}
                      className="text-knox-600 focus:ring-knox-500"
                    />
                    <span className="text-sm flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                      Graded
                    </span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="editCoinType"
                      checked={coinForm.isUngraded}
                      onChange={() => setCoinForm({ ...coinForm, isUngraded: true })}
                      className="text-knox-600 focus:ring-knox-500"
                    />
                    <span className="text-sm flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                      Ungraded
                    </span>
                  </label>
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditingCoin(null)} className="btn btn-secondary flex-1">
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

      {/* Upload Coin Types Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Upload Coin Types</h2>
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
                  <p className="text-slate-600 mb-2">Drop your coin types spreadsheet here</p>
                  <p className="text-sm text-slate-500 mb-4">
                    Columns: Coin Name, Catalog # (optional), Purchase Price (optional)
                  </p>
                  <input
                    type="file"
                    id="coin-upload"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileSelect(e.target.files[0])}
                  />
                  <label htmlFor="coin-upload" className="btn btn-primary cursor-pointer">
                    Select File
                  </label>
                </div>
              )}

              {uploadError && (
                <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-red-700">
                  <AlertCircle className="w-5 h-5" />
                  <span>{uploadError}</span>
                </div>
              )}

              {uploadData && !uploadResults && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                    <div>
                      <p className="font-medium">{uploadData.filename}</p>
                      <p className="text-sm text-slate-500">{uploadData.coins.length} coin types found</p>
                    </div>
                  </div>

                  <div className="max-h-48 overflow-y-auto border rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2">Name</th>
                          <th className="text-left px-3 py-2">Catalog #</th>
                          <th className="text-right px-3 py-2">Original $</th>
                          <th className="text-right px-3 py-2">Current $</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uploadData.coins.map((coin, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2">{coin.name}</td>
                            <td className="px-3 py-2 text-slate-500">{coin.catalogNumber || '-'}</td>
                            <td className="px-3 py-2 text-right">{coin.originalPrice ? `$${coin.originalPrice}` : '-'}</td>
                            <td className="px-3 py-2 text-right">{coin.currentPrice ? `$${coin.currentPrice}` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex gap-3">
                    <button onClick={resetUpload} className="btn btn-secondary flex-1">Cancel</button>
                    <button onClick={handleUploadCoins} disabled={uploading} className="btn btn-primary flex-1">
                      {uploading ? 'Uploading...' : 'Import Coins'}
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
                      <p className="text-slate-500">{uploadResults.imported} coin types added</p>
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

                  <button onClick={() => { setShowUploadModal(false); resetUpload(); }} className="btn btn-primary w-full">
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
