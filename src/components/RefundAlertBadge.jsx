import { useState, useEffect } from 'react'
import api from '../lib/api'

export default function RefundAlertBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    fetchCount()
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