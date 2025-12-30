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
      // Includes graded/ungraded sub-breakdown for each coin type
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
              ct_totals.total_for_coin,
              uc.quantity::decimal / NULLIF(ct_totals.total_for_coin, 0) as share_pct,
              ct.catalog_id
            FROM user_contributions uc
            JOIN coin_totals ct_totals ON uc.coin_type_id = ct_totals.coin_type_id
            JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
            WHERE uc.user_id = $1 AND uc.quantity > 0
          ),
          coin_sales AS (
            SELECT 
              uc.batch_id,
              uc.coin_type_id,
              uc.user_contributed,
              uc.total_for_coin,
              uc.share_pct,
              uc.catalog_id,
              -- Total sales (graded + ungraded)
              COALESCE(SUM(st.quantity_sold), 0) as total_sold,
              COALESCE(SUM(st.payout), 0) as total_payout_all,
              COALESCE(SUM(st.payout * uc.share_pct), 0) as user_payout,
              -- Graded only (same coin_type_id)
              COALESCE(SUM(CASE WHEN st.coin_type_id = uc.coin_type_id THEN st.quantity_sold ELSE 0 END), 0) as graded_sold,
              COALESCE(SUM(CASE WHEN st.coin_type_id = uc.coin_type_id THEN st.payout ELSE 0 END), 0) as graded_payout_all,
              COALESCE(SUM(CASE WHEN st.coin_type_id = uc.coin_type_id THEN st.payout * uc.share_pct ELSE 0 END), 0) as graded_user_payout
            FROM user_contribs uc
            LEFT JOIN sales_transactions st ON st.coin_type_id = uc.coin_type_id
              AND COALESCE(st.is_refund, false) = false
            GROUP BY uc.batch_id, uc.coin_type_id, uc.user_contributed, uc.total_for_coin, uc.share_pct, uc.catalog_id
          ),
          -- Get ungraded sales separately
          ungraded_sales AS (
            SELECT 
              cs.batch_id,
              cs.coin_type_id,
              COALESCE(SUM(st.quantity_sold), 0) as ungraded_sold,
              COALESCE(SUM(st.payout), 0) as ungraded_payout_all,
              COALESCE(SUM(st.payout * cs.share_pct), 0) as ungraded_user_payout,
              bc.total_contributed as ungraded_pool
            FROM coin_sales cs
            JOIN coin_types ug ON ug.catalog_id = cs.catalog_id AND ug.is_ungraded = true
            LEFT JOIN batch_coins bc ON bc.batch_id = cs.batch_id AND bc.coin_type_id = ug.coin_type_id
            LEFT JOIN sales_transactions st ON st.coin_type_id = ug.coin_type_id 
              AND st.batch_id = cs.batch_id
              AND COALESCE(st.is_refund, false) = false
            GROUP BY cs.batch_id, cs.coin_type_id, bc.total_contributed
          )
          SELECT 
            b.batch_id,
            b.batch_name,
            b.ship_date,
            ct.coin_type_id,
            ct.name as coin_type_name,
            cs.user_contributed,
            cs.total_for_coin,
            cs.total_sold + COALESCE(us.ungraded_sold, 0) as total_sold,
            cs.total_payout_all + COALESCE(us.ungraded_payout_all, 0) as total_payout_all,
            cs.user_payout + COALESCE(us.ungraded_user_payout, 0) as user_payout,
            ROUND(cs.share_pct * 100, 1) as share_pct,
            -- Graded breakdown
            bc.total_contributed as graded_pool,
            cs.graded_sold,
            cs.graded_payout_all,
            cs.graded_user_payout,
            -- Ungraded breakdown
            COALESCE(us.ungraded_pool, 0) as ungraded_pool,
            COALESCE(us.ungraded_sold, 0) as ungraded_sold,
            COALESCE(us.ungraded_payout_all, 0) as ungraded_payout_all,
            COALESCE(us.ungraded_user_payout, 0) as ungraded_user_payout
          FROM coin_sales cs
          JOIN batches b ON cs.batch_id = b.batch_id
          JOIN coin_types ct ON cs.coin_type_id = ct.coin_type_id
          LEFT JOIN batch_coins bc ON bc.batch_id = cs.batch_id AND bc.coin_type_id = cs.coin_type_id
          LEFT JOIN ungraded_sales us ON us.batch_id = cs.batch_id AND us.coin_type_id = cs.coin_type_id
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

      // Get batch totals for payout overview
      if (action === 'batchTotals') {
        const result = await query(`
          SELECT 
            b.batch_id,
            b.batch_name,
            b.ship_date,
            (SELECT COUNT(DISTINCT user_id) FROM user_contributions WHERE batch_id = b.batch_id) as contributor_count,
            (SELECT COALESCE(SUM(total_contributed), 0) FROM batch_coins WHERE batch_id = b.batch_id) as total_coins,
            COALESCE(SUM(st.quantity_sold), 0) as total_sold,
            COALESCE(SUM(st.total_payout), 0) as total_ebay_payout,
            COALESCE(SUM(st.profit), 0) as total_profit,
            COALESCE(SUM(st.profit_share), 0) as total_admin_share,
            COALESCE(SUM(st.profit), 0) - COALESCE(SUM(st.profit_share), 0) as total_member_profit,
            COALESCE(SUM(st.payout), 0) as total_member_payout
          FROM batches b
          LEFT JOIN sales_transactions st ON b.batch_id = st.batch_id AND COALESCE(st.is_refund, false) = false
          GROUP BY b.batch_id, b.batch_name, b.ship_date
          ORDER BY b.ship_date DESC NULLS LAST
        `);
        return res.json(result.rows);
      }

      // Get breakdown for a specific batch
      if (action === 'batchBreakdown') {
        const { batchId } = req.query;
        if (!batchId) return res.status(400).json({ error: 'Batch ID required' });
        
        // Query directly from sales_transactions to avoid duplicate counting
        const result = await query(`
          SELECT 
            st.coin_type_id,
            ct.name as coin_type_name,
            ct.is_ungraded,
            bc.total_contributed as pool,
            SUM(st.quantity_sold) as sold,
            bc.cost_per_coin,
            bc.grading_cost_per_coin,
            SUM(st.total_payout) as ebay_payout,
            SUM(st.profit) as profit,
            SUM(st.profit_share) as admin_share,
            SUM(st.profit) - SUM(st.profit_share) as member_profit,
            SUM(st.payout) as member_payout
          FROM sales_transactions st
          JOIN coin_types ct ON st.coin_type_id = ct.coin_type_id
          LEFT JOIN batch_coins bc ON bc.batch_id = st.batch_id AND bc.coin_type_id = st.coin_type_id
          WHERE st.batch_id = $1 AND COALESCE(st.is_refund, false) = false
          GROUP BY st.coin_type_id, ct.name, ct.is_ungraded, bc.total_contributed, bc.cost_per_coin, bc.grading_cost_per_coin
          ORDER BY ct.name
        `, [batchId]);
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

    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { payoutId, amount, paymentMethod, paymentReference, notes, payoutDate } = req.body;

      if (!payoutId) {
        return res.status(400).json({ error: 'Payout ID required' });
      }

      const result = await query(
        `UPDATE payouts 
         SET amount = COALESCE($2, amount),
             payment_method = COALESCE($3, payment_method),
             payment_reference = COALESCE($4, payment_reference),
             notes = COALESCE($5, notes),
             payout_date = COALESCE($6, payout_date)
         WHERE payout_id = $1
         RETURNING *`,
        [payoutId, amount, paymentMethod, paymentReference, notes, payoutDate]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Payout not found' });
      }
      return res.json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { payoutId } = req.query;

      if (!payoutId) {
        return res.status(400).json({ error: 'Payout ID required' });
      }

      await query('DELETE FROM payouts WHERE payout_id = $1', [payoutId]);
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
