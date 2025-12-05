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
    // Simplified query - returns amounts owed based on user contributions and unpaid transactions
    const result = await sql`
      WITH user_shares AS (
        SELECT 
          uc.user_id,
          uc.group_id,
          uc.graded_coin_id,
          uc.quantity::decimal / NULLIF(SUM(uc.quantity) OVER (PARTITION BY uc.group_id, uc.graded_coin_id), 0) as share_pct
        FROM user_contributions uc
      ),
      unpaid_transactions AS (
        SELECT 
          st.transaction_id,
          st.group_id,
          st.graded_coin_id,
          st.profit_share,
          st.sale_date
        FROM sales_transactions st
        LEFT JOIN payout_items pi ON st.transaction_id = pi.transaction_id
        WHERE pi.item_id IS NULL
      )
      SELECT 
        u.user_id,
        u.username,
        u.full_name,
        g.group_id,
        g.group_name,
        COALESCE(SUM(ut.profit_share * us.share_pct), 0) as amount_owed,
        COUNT(DISTINCT ut.transaction_id) as transaction_count
      FROM users u
      CROSS JOIN groups g
      LEFT JOIN user_shares us ON u.user_id = us.user_id AND g.group_id = us.group_id
      LEFT JOIN unpaid_transactions ut ON us.group_id = ut.group_id 
        AND (us.graded_coin_id = ut.graded_coin_id OR ut.graded_coin_id IS NULL)
      WHERE us.user_id IS NOT NULL
      GROUP BY u.user_id, u.username, u.full_name, g.group_id, g.group_name
      HAVING COALESCE(SUM(ut.profit_share * us.share_pct), 0) > 0
      ORDER BY g.group_name, amount_owed DESC
    `;

    res.json(result.rows);
  } catch (error) {
    console.error('Payouts owed error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
