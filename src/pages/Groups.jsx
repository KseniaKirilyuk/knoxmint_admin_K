import { useState, useEffect } from 'react'
import { Plus, Users, TrendingUp, Settings, X } from 'lucide-react'
import api from '../lib/api'

export default function Groups() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState(null)
  const [formData, setFormData] = useState({
    groupName: '',
    grader: 'NGC',
    labelType: 'FDI',
    profitSharePercentage: 0.33,
    profitShareMinimum: 8.00,
    profitShareMaximum: '',
    description: ''
  })

  useEffect(() => {
    fetchGroups()
  }, [])

  const fetchGroups = async () => {
    try {
      const response = await api.get('/groups')
      setGroups(response.data)
    } catch (error) {
      console.error('Error fetching groups:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const data = {
        ...formData,
        profitShareMaximum: formData.profitShareMaximum || null
      }
      if (editingGroup) {
        await api.put(`/groups/${editingGroup.group_id}`, data)
      } else {
        await api.post('/groups', data)
      }
      setShowModal(false)
      setEditingGroup(null)
      resetForm()
      fetchGroups()
    } catch (error) {
      console.error('Error saving group:', error)
      alert(error.response?.data?.error || 'Error saving group')
    }
  }

  const resetForm = () => {
    setFormData({
      groupName: '',
      grader: 'NGC',
      labelType: 'FDI',
      profitSharePercentage: 0.33,
      profitShareMinimum: 8.00,
      profitShareMaximum: '',
      description: ''
    })
  }

  const handleEdit = (group) => {
    setEditingGroup(group)
    setFormData({
      groupName: group.group_name,
      grader: group.grader || 'NGC',
      labelType: group.label_type || 'FDI',
      profitSharePercentage: parseFloat(group.profit_share_percentage) || 0.33,
      profitShareMinimum: parseFloat(group.profit_share_minimum) || 8.00,
      profitShareMaximum: group.profit_share_maximum || '',
      description: group.description || ''
    })
    setShowModal(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Groups</h1>
          <p className="text-slate-500 mt-1">Manage selling groups and profit share settings</p>
        </div>
        <button
          onClick={() => {
            setEditingGroup(null)
            resetForm()
            setShowModal(true)
          }}
          className="btn btn-primary gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Group
        </button>
      </div>

      {/* Groups Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-knox-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((group) => (
            <div key={group.group_id} className="card p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">{group.group_name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 bg-knox-100 text-knox-700 rounded text-xs font-medium">
                      {group.grader}
                    </span>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-medium">
                      {group.label_type}
                    </span>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  group.status === 'Active'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-700'
                }`}>
                  {group.status}
                </span>
              </div>

              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Members
                  </span>
                  <span className="font-medium">{group.member_count || 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Total Profit
                  </span>
                  <span className="font-medium text-emerald-600">
                    ${parseFloat(group.total_profit || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-500">Transactions</span>
                  <span className="font-medium">{group.transaction_count || 0}</span>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 mb-2">Profit Share Settings</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-slate-600">
                    {(parseFloat(group.profit_share_percentage) * 100).toFixed(0)}%
                  </span>
                  <span className="text-slate-400">|</span>
                  <span className="text-slate-600">
                    Min: ${parseFloat(group.profit_share_minimum).toFixed(2)}
                  </span>
                  {group.profit_share_maximum && (
                    <>
                      <span className="text-slate-400">|</span>
                      <span className="text-slate-600">
                        Max: ${parseFloat(group.profit_share_maximum).toFixed(2)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleEdit(group)}
                className="mt-4 btn btn-secondary w-full gap-2"
              >
                <Settings className="w-4 h-4" />
                Edit Group
              </button>
            </div>
          ))}

          {groups.length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-500">
              No groups yet. Create your first group to get started.
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
              <h2 className="text-lg font-semibold">
                {editingGroup ? 'Edit Group' : 'Create New Group'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 hover:bg-slate-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="label">Group Name *</label>
                <input
                  type="text"
                  className="input"
                  value={formData.groupName}
                  onChange={(e) => setFormData({ ...formData, groupName: e.target.value })}
                  placeholder="e.g., NGC FDI"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Grader</label>
                  <select
                    className="input"
                    value={formData.grader}
                    onChange={(e) => setFormData({ ...formData, grader: e.target.value })}
                  >
                    <option value="NGC">NGC</option>
                    <option value="PCGS">PCGS</option>
                    <option value="Ungraded">Ungraded</option>
                  </select>
                </div>
                <div>
                  <label className="label">Label Type</label>
                  <select
                    className="input"
                    value={formData.labelType}
                    onChange={(e) => setFormData({ ...formData, labelType: e.target.value })}
                  >
                    <option value="FDI">FDI (First Day of Issue)</option>
                    <option value="FR">FR (First Release)</option>
                    <option value="FS">FS (First Strike)</option>
                    <option value="RP">RP (Reverse Proof)</option>
                    <option value="PR">PR (Proof)</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg p-4 space-y-4">
                <h3 className="font-medium text-slate-900">Profit Share Settings</h3>
                <div>
                  <label className="label">Profit Share Percentage</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="input"
                      value={(formData.profitSharePercentage * 100).toFixed(0)}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        profitSharePercentage: parseFloat(e.target.value) / 100 
                      })}
                      min="0"
                      max="100"
                      step="1"
                    />
                    <span className="text-slate-500">%</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Percentage of profit paid to members</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Minimum ($)</label>
                    <input
                      type="number"
                      className="input"
                      value={formData.profitShareMinimum}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        profitShareMinimum: parseFloat(e.target.value) 
                      })}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div>
                    <label className="label">Maximum ($)</label>
                    <input
                      type="number"
                      className="input"
                      value={formData.profitShareMaximum}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        profitShareMaximum: e.target.value 
                      })}
                      min="0"
                      step="0.01"
                      placeholder="No limit"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={2}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional notes about this group"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary flex-1">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary flex-1">
                  {editingGroup ? 'Save Changes' : 'Create Group'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
