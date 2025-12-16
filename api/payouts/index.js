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

  try {
    if (req.method === 'GET') {
      const { action, userId } = req.query;

      // Get member totals
      if (action === 'memberTotals') {
        // Step 1: Calculate each user's share per coin type
        // share = user's contribution / total contributions for that coin type
        // Step 2: For each sale, user gets: sale.payout * their share
        // Note: Refunds have negative payout values and will offset earnings
        const result = await query(`
          WITH contribution_shares AS (
            -- Each user's share percentage per coin type
            SELECT 
              uc.user_id,
              uc.coin_type_id,
              SUM(uc.quantity) as user_contributed,
              SUM(SUM(uc.quantity)) OVER (PARTITION BY uc.coin_type_id) as total_contributed,
              SUM(uc.quantity)::decimal / NULLIF(SUM(SUM(uc.quantity)) OVER (PARTITION BY uc.coin_type_id), 0) as share_pct
            FROM user_contributions uc
            WHERE uc.quantity > 0
            GROUP BY uc.user_id, uc.coin_type_id
          ),
          sale_splits AS (
            -- For each sale/refund, calculate each user's portion based on their share
            -- Refunds have negative payout and will reduce earnings
            SELECT 
              cs.user_id,
              st.transaction_id,
              st.payout * cs.share_pct as user_payout,
              st.is_paid_out,
              COALESCE(st.is_refund, false) as is_refund
            FROM sales_transactions st
            JOIN contribution_shares cs ON st.coin_type_id = cs.coin_type_id
            WHERE st.payout != 0 OR st.is_refund = true
          ),
          user_totals AS (
            SELECT 
              user_id,
              COALESCE(SUM(user_payout), 0) as total_earned,
              COALESCE(SUM(CASE WHEN is_paid_out = false THEN user_payout ELSE 0 END), 0) as unpaid,
              COALESCE(SUM(CASE WHEN is_paid_out = true THEN user_payout ELSE 0 END), 0) as paid_from_sales,
              COUNT(DISTINCT CASE WHEN is_refund = false THEN transaction_id END) as sale_count,
              COUNT(DISTINCT CASE WHEN is_refund = true THEN transaction_id END) as refund_count,
              COALESCE(SUM(CASE WHEN is_refund = true THEN user_payout ELSE 0 END), 0) as refund_total
            FROM sale_splits
            GROUP BY user_id
          )
          SELECT 
            u.user_id,
            u.username,
            u.full_name,
            COALESCE(SUM(uc.quantity), 0) as total_contributed,
            COALESCE(ut.total_earned, 0) as total_earned,
            COALESCE(ut.unpaid, 0) as unpaid,
            COALESCE((SELECT SUM(amount) FROM payouts WHERE user_id = u.user_id AND status = 'Paid'), 0) as total_paid,
            COALESCE(ut.sale_count, 0) as sale_count,
            COALESCE(ut.refund_count, 0) as refund_count,
            COALESCE(ut.refund_total, 0) as refund_total
          FROM users u
          LEFT JOIN user_contributions uc ON u.user_id = uc.user_id
          LEFT JOIN user_totals ut ON u.user_id = ut.user_id
          GROUP BY u.user_id, u.username, u.full_name, ut.total_earned, ut.unpaid, ut.sale_count, ut.refund_count, ut.refund_total
          HAVING COALESCE(SUM(uc.quantity), 0) > 0 OR COALESCE(ut.total_earned, 0) != 0
          ORDER BY COALESCE(ut.unpaid, 0) DESC, u.full_name
        `);
        
        // Calculate balance = total_earned - total_paid (from payouts table)
        const rows = result.rows.map(r => ({
          ...r,
          balance: Math.max(0, parseFloat(r.total_earned || 0) - parseFloat(r.total_paid || 0))
        }));
        
        return res.json(rows);
      }

      // Get breakdown for a specific member
      if (action === 'memberBreakdown' && userId) {
        const result = await query(`
          WITH coin_totals AS (
            -- Get total contributions per coin type across ALL users
            SELECT 
              coin_type_id,
              SUM(quantity) as total_for_coin
            FROM user_contributions
            WHERE quantity > 0
            GROUP BY coin_type_id
          ),
          user_contribs AS (
            -- Get this user's contributions with their share
            SELECT 
              uc.user_id,
              uc.batch_id,
              uc.coin_type_id,
              uc.quantity as user_contributed,
              ct.total_for_coin,
              uc.quantity::decimal / NULLIF(ct.total_for_coin, 0) as share_pct
            FROM user_contributions uc
            JOIN coin_totals ct ON uc.coin_type_id = ct.coin_type_id
            WHERE uc.user_id = $1 AND uc.quantity > 0
          ),
          coin_sales AS (
            SELECT 
              uc.batch_id,
              uc.coin_type_id,
              uc.user_contributed,
              uc.total_for_coin,
              uc.share_pct,
              COUNT(CASE WHEN COALESCE(st.is_refund, false) = false THEN st.transaction_id END) as sales_count,
              COUNT(CASE WHEN st.is_refund = true THEN st.transaction_id END) as refund_count,
              COALESCE(SUM(st.quantity_sold), 0) as total_sold,
              COALESCE(SUM(st.payout * uc.share_pct), 0) as user_payout,
              COALESCE(SUM(CASE WHEN st.is_refund = true THEN st.payout * uc.share_pct ELSE 0 END), 0) as refund_amount
            FROM user_contribs uc
            LEFT JOIN sales_transactions st ON uc.coin_type_id = st.coin_type_id
            GROUP BY uc.batch_id, uc.coin_type_id, uc.user_contributed, uc.total_for_coin, uc.share_pct
          )
          SELECT 
            b.batch_id,
            b.batch_name,
            b.ship_date,
            ct.coin_type_id,
            ct.name as coin_type_name,
            cs.user_contributed,
            cs.total_for_coin,
            cs.total_sold,
            cs.user_payout,
            cs.refund_count,
            cs.refund_amount,
            ROUND(cs.share_pct * 100, 1) as share_pct
          FROM coin_sales cs
          JOIN batches b ON cs.batch_id = b.batch_id
          JOIN coin_types ct ON cs.coin_type_id = ct.coin_type_id
          ORDER BY b.ship_date DESC NULLS LAST, ct.name
        `, [userId]);
        return res.json(result.rows);
      }

      // Get payment history
      if (action === 'history') {
        const result = await query(`
          SELECT p.*, u.username, u.full_name
          FROM payouts p
          JOIN users u ON p.user_id = u.user_id
          ORDER BY p.payout_date DESC, p.created_at DESC
          LIMIT 100
        `);
        return res.json(result.rows);
      }

      return res.json([]);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { userId, amount, paymentMethod, paymentReference, notes } = req.body;

      if (!userId || !amount) {
        return res.status(400).json({ error: 'User ID and amount required' });
      }

      const result = await query(
        `INSERT INTO payouts (user_id, payout_date, amount, status, payment_method, payment_reference, notes)
         VALUES ($1, CURRENT_DATE, $2, 'Paid', $3, $4, $5)
         RETURNING *`,
        [userId, amount, paymentMethod || 'Manual', paymentReference, notes]
      );
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
