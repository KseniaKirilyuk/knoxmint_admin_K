import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

async function getAmountsOwed() {
  const result = await query(`
    WITH user_shares AS (
      SELECT 
        uc.user_id,
        uc.group_id,
        uc.coin_type_id,
        uc.quantity::decimal / NULLIF(SUM(uc.quantity) OVER (PARTITION BY uc.group_id, uc.coin_type_id), 0) as share_pct
      FROM user_contributions uc
    ),
    unpaid_transactions AS (
      SELECT 
        st.transaction_id,
        st.group_id,
        st.coin_type_id,
        st.profit_share
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
      AND (us.coin_type_id = ut.coin_type_id OR ut.coin_type_id IS NULL)
    WHERE us.user_id IS NOT NULL
    GROUP BY u.user_id, u.username, u.full_name, g.group_id, g.group_name
    HAVING COALESCE(SUM(ut.profit_share * us.share_pct), 0) > 0
    ORDER BY g.group_name, amount_owed DESC
  `);
  return result.rows;
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    if (req.method === 'GET') {
      const { action, status, limit = 100 } = req.query;

      // Get amounts owed
      if (action === 'owed') {
        const rows = await getAmountsOwed();
        return res.json(rows);
      }
      
      // Get payouts list
      let sql = `
        SELECT p.*, u.username, u.full_name, g.group_name
        FROM payouts p
        JOIN users u ON p.user_id = u.user_id
        JOIN groups g ON p.group_id = g.group_id
      `;
      const params = [];

      if (status) {
        sql += ' WHERE p.status = $1';
        params.push(status);
      }
      
      sql += ` ORDER BY p.payout_date DESC, p.payout_id DESC LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));

      const result = await query(sql, params);
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { userId, groupId, amount, paymentMethod, paymentReference, notes } = req.body;

      const result = await query(
        `INSERT INTO payouts (user_id, group_id, payout_date, amount, status, payment_method, payment_reference, notes)
         VALUES ($1, $2, CURRENT_DATE, $3, 'Pending', $4, $5, $6)
         RETURNING *`,
        [userId, groupId, amount, paymentMethod, paymentReference, notes]
      );
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
