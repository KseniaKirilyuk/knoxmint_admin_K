import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const salesResult = await query(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(sale_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(profit_share), 0) as total_profit_share,
        COALESCE(AVG(profit), 0) as avg_profit
      FROM sales_transactions
    `);

    const pendingResult = await query(`
      SELECT COUNT(*) as pending_count, COALESCE(SUM(amount), 0) as pending_amount
      FROM payouts WHERE status = 'Pending'
    `);

    const paidResult = await query(`
      SELECT COUNT(*) as paid_count, COALESCE(SUM(amount), 0) as paid_amount
      FROM payouts WHERE status = 'Paid'
    `);

    const groupsResult = await query(`
      SELECT COUNT(*) as active_groups FROM groups WHERE status = 'Active'
    `);

    const usersResult = await query(`
      SELECT COUNT(DISTINCT user_id) as active_users FROM user_contributions
    `);

    res.json({
      sales: salesResult.rows[0],
      pendingPayouts: pendingResult.rows[0],
      paidPayouts: paidResult.rows[0],
      activeGroups: parseInt(groupsResult.rows[0].active_groups),
      activeUsers: parseInt(usersResult.rows[0].active_users)
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
