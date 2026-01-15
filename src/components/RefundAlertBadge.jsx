import { useState, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import api from '../lib/api'
import { AlertTriangle } from 'lucide-react'

// Small badge component to show pending refund alerts count
// Add this to your Sidebar/Navigation next to "Refund Alerts" link

export default function RefundAlertBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetchCount()
    // Refresh every 60 seconds
    const interval = setInterval(fetchCount, 60000)
    return () => clearInterval(interval)
  }, [])

  const fetchCount = async () => {
    try {
      const res = await api.get('/refunds?action=count')
      setCount(res.data.count || 0)
    } catch (err) {
      console.error('Error fetching refund alert count:', err)
    }
  }

  if (count === 0) return null

  return (
    <span className="ml-auto px-2 py-0.5 bg-red-500 text-white text-xs font-bold rounded-full">
      {count}
    </span>
  )
}

// Example usage in your Sidebar:
// 
// import RefundAlertBadge from './RefundAlertBadge'
//
// <NavLink to="/refunds" className="nav-link flex items-center">
//   <AlertTriangle className="w-5 h-5 mr-3" />
//   Refund Alerts
//   <RefundAlertBadge />
// </NavLink>
