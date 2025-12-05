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
    const { groupBy = 'day' } = req.query;

    let result;
    if (groupBy === 'month') {
      result = await sql`
        SELECT 
          TO_CHAR(sale_date, 'YYYY-MM') as period,
          COUNT(*) as transaction_count,
          SUM(sale_price) as revenue,
          SUM(profit) as profit
        FROM sales_transactions
        GROUP BY TO_CHAR(sale_date, 'YYYY-MM')
        ORDER BY period
      `;
    } else if (groupBy === 'week') {
      result = await sql`
        SELECT 
          TO_CHAR(DATE_TRUNC('week', sale_date), 'YYYY-MM-DD') as period,
          COUNT(*) as transaction_count,
          SUM(sale_price) as revenue,
          SUM(profit) as profit
        FROM sales_transactions
        GROUP BY DATE_TRUNC('week', sale_date)
        ORDER BY period
      `;
    } else {
      result = await sql`
        SELECT 
          TO_CHAR(sale_date, 'YYYY-MM-DD') as period,
          COUNT(*) as transaction_count,
          SUM(sale_price) as revenue,
          SUM(profit) as profit
        FROM sales_transactions
        GROUP BY sale_date
        ORDER BY period
      `;
    }

    res.json(result.rows);
  } catch (error) {
    console.error('Sales over time error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
