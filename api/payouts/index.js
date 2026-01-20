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
      const { action, userId, batchId } = req.query;

      // Get all members with balances
      if (action === 'memberTotals') {
        const result = await query(`
          SELECT 
            u.user_id,
            u.username,
            u.full_name,
            COALESCE(contrib.total_contributed, 0) as total_contributed,
            COALESCE(earnings.total_earned, 0) as total_earned,
            COALESCE(paid.total_paid, 0) as total_paid
          FROM users u
          LEFT JOIN (
            SELECT user_id, SUM(quantity) as total_contributed
            FROM user_contributions
            GROUP BY user_id
          ) contrib ON u.user_id = contrib.user_id
          LEFT JOIN (
            SELECT 
              uc.user_id,
              SUM(
                st.payout * (uc.quantity::decimal / NULLIF(batch_totals.total_qty, 0))
              ) as total_earned
            FROM user_contributions uc
            JOIN (
              SELECT batch_id, coin_type_id, SUM(quantity) as total_qty
              FROM user_contributions
              GROUP BY batch_id, coin_type_id
            ) batch_totals ON uc.batch_id = batch_totals.batch_id AND uc.coin_type_id = batch_totals.coin_type_id
            JOIN sales_transactions st ON st.batch_id = uc.batch_id AND st.coin_type_id = uc.coin_type_id
              AND COALESCE(st.is_refund, false) = false
              AND COALESCE(st.is_refunded, false) = false
            GROUP BY uc.user_id
          ) earnings ON u.user_id = earnings.user_id
          LEFT JOIN (
            SELECT user_id, SUM(amount) as total_paid
            FROM payouts
            WHERE status = 'Paid'
            GROUP BY user_id
          ) paid ON u.user_id = paid.user_id
          WHERE u.role = 'user' AND u.is_active = true
          ORDER BY u.full_name
        `);
        
        const rows = result.rows.map(r => ({
          ...r,
          balance: Math.max(0, parseFloat(r.total_earned || 0) - parseFloat(r.total_paid || 0))
        }));
        
        return res.json(rows);
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
          LEFT JOIN sales_transactions st ON b.batch_id = st.batch_id 
            AND COALESCE(st.is_refund, false) = false
            AND COALESCE(st.is_refunded, false) = false
          GROUP BY b.batch_id, b.batch_name, b.ship_date
          ORDER BY b.ship_date DESC NULLS LAST
        `);
        return res.json(result.rows);
      }

      // Get breakdown for a specific batch
      if (action === 'batchBreakdown') {
        if (!batchId) return res.status(400).json({ error: 'Batch ID required' });
        
        const result = await query(`
          SELECT 
            ct.coin_type_id,
            ct.name as coin_type_name,
            ct.is_ungraded,
            bc.total_contributed as pool,
            COALESCE(SUM(st.quantity_sold), 0) as sold,
            bc.cost_per_coin,
            bc.grading_cost_per_coin,
            COALESCE(SUM(st.total_payout), 0) as ebay_payout,
            COALESCE(SUM(st.profit), 0) as profit,
            COALESCE(SUM(st.profit_share), 0) as admin_share,
            COALESCE(SUM(st.profit), 0) - COALESCE(SUM(st.profit_share), 0) as member_profit,
            COALESCE(SUM(st.payout), 0) as member_payout
          FROM batch_coins bc
          JOIN coin_types ct ON bc.coin_type_id = ct.coin_type_id
          LEFT JOIN sales_transactions st ON st.batch_id = bc.batch_id 
            AND st.coin_type_id = bc.coin_type_id 
            AND COALESCE(st.is_refund, false) = false
            AND COALESCE(st.is_refunded, false) = false
          WHERE bc.batch_id = $1
          GROUP BY ct.coin_type_id, ct.name, ct.is_ungraded, bc.total_contributed, bc.cost_per_coin, bc.grading_cost_per_coin
          ORDER BY ct.name
        `, [batchId]);
        return res.json(result.rows);
      }

      // Get breakdown for a specific member
      // Returns data for each batch/coin_type the member contributed to
      if (action === 'memberBreakdown' && userId) {
        const result = await query(`
          WITH batch_totals AS (
            SELECT batch_id, coin_type_id, SUM(quantity) as total_qty
            FROM user_contributions
            WHERE quantity > 0
            GROUP BY batch_id, coin_type_id
          ),
          user_contribs AS (
            SELECT 
              uc.batch_id,
              uc.coin_type_id,
              uc.quantity as user_contributed,
              bt.total_qty as batch_pool,
              ROUND((uc.quantity::decimal / NULLIF(bt.total_qty, 0) * 100)::numeric, 1) as share_pct
            FROM user_contributions uc
            JOIN batch_totals bt ON uc.batch_id = bt.batch_id AND uc.coin_type_id = bt.coin_type_id
            WHERE uc.user_id = $1 AND uc.quantity > 0
          ),
          coin_sales AS (
            SELECT 
              uc.batch_id,
              uc.coin_type_id,
              uc.user_contributed,
              uc.batch_pool,
              uc.share_pct,
              COALESCE(SUM(st.quantity_sold), 0) as sold,
              COALESCE(SUM(st.total_payout), 0) as ebay_payout,
              COALESCE(SUM(st.profit), 0) as profit,
              COALESCE(SUM(st.profit_share), 0) as admin_share,
              COALESCE(SUM(st.profit), 0) - COALESCE(SUM(st.profit_share), 0) as member_profit,
              COALESCE(SUM(st.payout), 0) as total_batch_member_payout,
              COALESCE(SUM(st.payout) * (uc.user_contributed::decimal / NULLIF(uc.batch_pool, 0)), 0) as member_payout
            FROM user_contribs uc
            LEFT JOIN sales_transactions st ON st.batch_id = uc.batch_id 
              AND st.coin_type_id = uc.coin_type_id
              AND COALESCE(st.is_refund, false) = false
              AND COALESCE(st.is_refunded, false) = false
            GROUP BY uc.batch_id, uc.coin_type_id, uc.user_contributed, uc.batch_pool, uc.share_pct
          )
          SELECT 
            cs.batch_id,
            b.batch_name,
            b.ship_date,
            cs.coin_type_id,
            ct.name as coin_type_name,
            ct.is_ungraded,
            cs.batch_pool as pool,
            cs.user_contributed,
            cs.share_pct,
            cs.sold,
            cs.ebay_payout,
            cs.profit,
            cs.admin_share,
            cs.member_profit,
            cs.member_payout,
            bc.cost_per_coin,
            bc.grading_cost_per_coin
          FROM coin_sales cs
          JOIN batches b ON cs.batch_id = b.batch_id
          JOIN coin_types ct ON cs.coin_type_id = ct.coin_type_id
          LEFT JOIN batch_coins bc ON cs.batch_id = bc.batch_id AND cs.coin_type_id = bc.coin_type_id
          ORDER BY b.ship_date DESC NULLS LAST, ct.name
        `, [userId]);
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

      const result = await query(`
        INSERT INTO payouts (user_id, payout_date, amount, status, payment_method, payment_reference, notes)
        VALUES ($1, CURRENT_DATE, $2, 'Paid', $3, $4, $5)
        RETURNING *
      `, [userId, amount, paymentMethod, paymentReference, notes]);

      return res.json(result.rows[0]);
    }

    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { payoutId } = req.query;
      const { status, paymentMethod, paymentReference, notes } = req.body;

      if (!payoutId) {
        return res.status(400).json({ error: 'Payout ID required' });
      }

      const result = await query(`
        UPDATE payouts
        SET status = COALESCE($1, status),
            payment_method = COALESCE($2, payment_method),
            payment_reference = COALESCE($3, payment_reference),
            notes = COALESCE($4, notes),
            updated_at = CURRENT_TIMESTAMP
        WHERE payout_id = $5
        RETURNING *
      `, [status, paymentMethod, paymentReference, notes, payoutId]);

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
