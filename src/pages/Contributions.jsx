import { useState, useEffect, useCallback } from 'react'
import { Upload as UploadIcon, Users, Coins, Plus, Trash2, X, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../lib/api'

export default function Contributions() {
  const [contributions, setContributions] = useState([])
  const [groups, setGroups] = useState([])
  const [coinTypes, setCoinTypes] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [uploadData, setUploadData] = useState(null)
  const [uploadResults, setUploadResults] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragActive, setDragActive] = useState(false)

  const [addForm, setAddForm] = useState({
    userId: '',
    groupId: '',
    coinTypeId: '',
    quantity: 0
  })

  useEffect(() => {
    fetchData()
  }, [selectedGroup])

  const fetchData = async () => {
    setLoading(true)
    try {
      const [contribRes, groupsRes, coinTypesRes, usersRes] = await Promise.all([
        api.get(selectedGroup ? `/contributions?groupId=${selectedGroup}` : '/contributions'),
        api.get('/groups'),
        api.get('/contributions?action=coinTypes'),
        api.get('/users')
      ])
      setContributions(contribRes.data)
      setGroups(groupsRes.data)
      setCoinTypes(coinTypesRes.data)
      setUsers(usersRes.data.filter(u => u.role !== 'admin'))
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  // Group contributions by coin type for display
  const groupedContributions = contributions.reduce((acc, contrib) => {
    const key = contrib.coin_type_name
    if (!acc[key]) {
      acc[key] = {
        coinType: contrib.coin_type_name,
        coinTypeId: contrib.coin_type_id,
        total: 0,
        members: []
      }
    }
    acc[key].total += parseInt(contrib.quantity) || 0
    acc[key].members.push(contrib)
    return acc
  }, {})

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

  const handleFileSelect = async (file) => {
    if (!file) return
    setError('')
    setUploadResults(null)

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      
      const contributions = []
      
      // Parse each sheet as a group
      for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName]
        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' })
        
        if (sheetData.length < 2) continue

        const headers = sheetData[0].map(h => String(h || '').toLowerCase().trim())
        
        // Find columns: Slack Name, Qty, Coin Type
        const nameColIdx = headers.findIndex(h => h.includes('slack') || h.includes('name') || h.includes('member'))
        const qtyColIdx = headers.findIndex(h => h.includes('qty') || h.includes('quantity'))
        const coinTypeColIdx = headers.findIndex(h => h.includes('coin') || h.includes('type'))

        if (nameColIdx === -1 || qtyColIdx === -1) continue

        for (let i = 1; i < sheetData.length; i++) {
          const row = sheetData[i]
          if (!row || !row[nameColIdx]) continue

          const memberName = String(row[nameColIdx]).trim()
          const quantity = parseInt(row[qtyColIdx]) || 0
          const coinType = coinTypeColIdx >= 0 ? String(row[coinTypeColIdx]).trim() : 'Unknown'

          if (memberName && quantity >= 0) {
            contributions.push({
              memberName,
              quantity,
              coinType,
              groupName: sheetName
            })
          }
        }
      }

      setUploadData({
        filename: file.name,
        contributions,
        groups: [...new Set(contributions.map(c => c.groupName))],
        coinTypes: [...new Set(contributions.map(c => c.coinType))]
      })
    } catch (err) {
      setError('Error parsing file: ' + err.message)
    }
  }

  const handleUpload = async () => {
    if (!uploadData) return
    setUploading(true)
    setError('')

    try {
      const response = await api.post('/contributions', {
        action: 'bulkUpload',
        contributions: uploadData.contributions
      })
      setUploadResults(response.data)
      fetchData()
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const handleAddContribution = async (e) => {
    e.preventDefault()
    try {
      await api.post('/contributions', addForm)
      setShowAddModal(false)
      setAddForm({ userId: '', groupId: '', coinTypeId: '', quantity: 0 })
      fetchData()
    } catch (err) {
      alert(err.response?.data?.error || 'Error adding contribution')
    }
  }

  const handleDeleteContribution = async (id) => {
    if (!confirm('Remove this contribution?')) return
    try {
      await api.delete(`/contributions?id=${id}`)
      fetchData()
    } catch (err) {
      alert('Error removing contribution')
    }
  }

  const resetUpload = () => {
    setUploadData(null)
    setUploadResults(null)
    setError('')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contributions</h1>
          <p className="text-slate-500 mt-1">Track member coin contributions by group</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowUploadModal(true)}
            className="btn btn-secondary gap-2"
          >
            <UploadIcon className="w-4 h-4" />
            Upload
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary gap-2"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-4">
        <select
          className="input w-64"
          value={selectedGroup}
          onChange={(e) => setSelectedGroup(e.target.value)}
        >
          <option value="">All Groups</option>
          {groups.map(g => (
            <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
          ))}
        </select>
      </div>

      {/* Contributions by Coin Type */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600"></div>
        </div>
      ) : Object.keys(groupedContributions).length === 0 ? (
        <div className="card p-12 text-center">
          <Coins className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 mb-2">No contributions yet</h3>
          <p className="text-slate-500 mb-4">Upload a spreadsheet or add contributions manually</p>
          <button onClick={() => setShowUploadModal(true)} className="btn btn-primary">
            Upload Contributions
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.values(groupedContributions).map((group) => (
            <div key={group.coinType} className="card">
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-knox-100 rounded-lg">
                    <Coins className="w-5 h-5 text-knox-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{group.coinType}</h3>
                    <p className="text-sm text-slate-500">{group.total} total coins</p>
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Member</th>
                      <th className="table-header">Group</th>
                      <th className="table-header text-right">Quantity</th>
                      <th className="table-header text-right">Ownership %</th>
                      <th className="table-header text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.members.map((contrib) => (
                      <tr key={contrib.id} className="hover:bg-slate-50">
                        <td className="table-cell font-medium">
                          {contrib.full_name || contrib.username}
                        </td>
                        <td className="table-cell">
                          <span className="px-2 py-1 bg-knox-50 text-knox-700 rounded text-xs">
                            {contrib.group_name}
                          </span>
                        </td>
                        <td className="table-cell text-right">{contrib.quantity}</td>
                        <td className="table-cell text-right">
                          {group.total > 0 
                            ? ((contrib.quantity / group.total) * 100).toFixed(2) 
                            : 0}%
                        </td>
                        <td className="table-cell text-right">
                          <button
                            onClick={() => handleDeleteContribution(contrib.id)}
                            className="p-1 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
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
                    Expected columns: Slack Name, Qty, Coin Type<br />
                    Each sheet = one group
                  </p>
                  <input
                    type="file"
                    id="contrib-upload"
                    className="hidden"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => handleFileSelect(e.target.files[0])}
                  />
                  <label htmlFor="contrib-upload" className="btn btn-primary cursor-pointer">
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
                        {uploadData.contributions.length} contributions found
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm font-medium text-slate-600 mb-2">Groups</p>
                      <div className="flex flex-wrap gap-1">
                        {uploadData.groups.map(g => (
                          <span key={g} className="px-2 py-1 bg-knox-100 text-knox-700 rounded text-xs">
                            {g}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="p-4 border rounded-lg">
                      <p className="text-sm font-medium text-slate-600 mb-2">Coin Types</p>
                      <div className="flex flex-wrap gap-1">
                        {uploadData.coinTypes.map(ct => (
                          <span key={ct} className="px-2 py-1 bg-emerald-100 text-emerald-700 rounded text-xs">
                            {ct}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

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

      {/* Add Contribution Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Add Contribution</h2>
              <button onClick={() => setShowAddModal(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddContribution} className="p-6 space-y-4">
              <div>
                <label className="label">Member *</label>
                <select
                  className="input"
                  value={addForm.userId}
                  onChange={(e) => setAddForm({ ...addForm, userId: e.target.value })}
                  required
                >
                  <option value="">Select member</option>
                  {users.map(u => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.full_name || u.username}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Group *</label>
                <select
                  className="input"
                  value={addForm.groupId}
                  onChange={(e) => setAddForm({ ...addForm, groupId: e.target.value })}
                  required
                >
                  <option value="">Select group</option>
                  {groups.map(g => (
                    <option key={g.group_id} value={g.group_id}>{g.group_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Coin Type *</label>
                <select
                  className="input"
                  value={addForm.coinTypeId}
                  onChange={(e) => setAddForm({ ...addForm, coinTypeId: e.target.value })}
                  required
                >
                  <option value="">Select coin type</option>
                  {coinTypes.map(ct => (
                    <option key={ct.coin_type_id} value={ct.coin_type_id}>{ct.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Quantity *</label>
                <input
                  type="number"
                  className="input"
                  value={addForm.quantity}
                  onChange={(e) => setAddForm({ ...addForm, quantity: parseInt(e.target.value) || 0 })}
                  min="0"
                  required
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  Add Contribution
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
