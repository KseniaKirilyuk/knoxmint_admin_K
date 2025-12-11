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
  // Calculate amounts owed based on:
  // 1. User contributions per batch/coin_type
  // 2. Sales transactions per batch/coin_type
  // 3. FIFO: earlier batches get paid first
  const result = await query(`
    WITH batch_order AS (
      SELECT batch_id, ROW_NUMBER() OVER (ORDER BY ship_date ASC NULLS LAST, created_at ASC) as batch_rank
      FROM batches
      WHERE status = 'Active'
    ),
    user_shares AS (
      SELECT 
        uc.user_id,
        uc.batch_id,
        uc.coin_type_id,
        uc.quantity,
        uc.quantity::decimal / NULLIF(SUM(uc.quantity) OVER (PARTITION BY uc.batch_id, uc.coin_type_id), 0) as share_pct
      FROM user_contributions uc
    ),
    unpaid_transactions AS (
      SELECT 
        st.transaction_id,
        st.batch_id,
        st.coin_type_id,
        st.profit_share,
        COALESCE(st.profit_share, st.net_amount - COALESCE(bc.original_price, 0)) as calculated_profit
      FROM sales_transactions st
      LEFT JOIN batch_coins bc ON st.batch_id = bc.batch_id AND st.coin_type_id = bc.coin_type_id
      WHERE st.is_paid_out = false
    )
    SELECT 
      u.user_id,
      u.username,
      u.full_name,
      b.batch_id,
      b.batch_name,
      bo.batch_rank,
      COALESCE(SUM(ut.calculated_profit * us.share_pct), 0) as amount_owed,
      COUNT(DISTINCT ut.transaction_id) as transaction_count
    FROM users u
    JOIN user_shares us ON u.user_id = us.user_id
    JOIN batches b ON us.batch_id = b.batch_id
    JOIN batch_order bo ON b.batch_id = bo.batch_id
    LEFT JOIN unpaid_transactions ut ON us.batch_id = ut.batch_id 
      AND us.coin_type_id = ut.coin_type_id
    GROUP BY u.user_id, u.username, u.full_name, b.batch_id, b.batch_name, bo.batch_rank
    HAVING COALESCE(SUM(ut.calculated_profit * us.share_pct), 0) > 0
    ORDER BY bo.batch_rank, amount_owed DESC
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
        SELECT p.*, u.username, u.full_name, b.batch_name
        FROM payouts p
        JOIN users u ON p.user_id = u.user_id
        JOIN batches b ON p.batch_id = b.batch_id
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
      
      const { userId, batchId, amount, paymentMethod, paymentReference, notes } = req.body;

      const result = await query(
        `INSERT INTO payouts (user_id, batch_id, payout_date, amount, status, payment_method, payment_reference, notes)
         VALUES ($1, $2, CURRENT_DATE, $3, 'Pending', $4, $5, $6)
         RETURNING *`,
        [userId, batchId, amount, paymentMethod, paymentReference, notes]
      );
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { payoutId } = req.query;
      const { status } = req.body;

      if (payoutId && status) {
        await query(
          'UPDATE payouts SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE payout_id = $2',
          [status, payoutId]
        );
        return res.json({ success: true });
      }
      
      return res.status(400).json({ error: 'Payout ID and status required' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
