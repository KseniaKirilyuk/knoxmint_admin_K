import { sql } from '@vercel/postgres';
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
    const result = await sql`
      SELECT 
        g.group_id,
        g.group_name,
        g.grader,
        COUNT(st.transaction_id) as transaction_count,
        COALESCE(SUM(st.sale_price), 0) as total_revenue,
        COALESCE(SUM(st.profit), 0) as total_profit,
        COALESCE(SUM(st.profit_share), 0) as total_profit_share
      FROM groups g
      LEFT JOIN sales_transactions st ON g.group_id = st.group_id
      GROUP BY g.group_id, g.group_name, g.grader
      ORDER BY total_revenue DESC
    `;

    res.json(result.rows);
  } catch (error) {
    console.error('Sales by group error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
