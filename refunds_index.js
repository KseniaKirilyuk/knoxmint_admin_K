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
    // GET - List refund alerts
    if (req.method === 'GET') {
      const { action, alertId, status = 'pending' } = req.query;

      // Get count of pending alerts (for badge)
      if (action === 'count') {
        const result = await query(
          `SELECT COUNT(*) as count FROM refund_alerts WHERE status = 'pending'`
        );
        return res.json({ count: parseInt(result.rows[0].count) || 0 });
      }

      // Get single alert details
      if (action === 'details' && alertId) {
        const alertResult = await query(`
          SELECT ra.*, 
                 st_refund.item_title as refund_title,
                 st_refund.sale_date as refund_date,
                 st_orig.item_title as original_title,
                 st_orig.sale_price as original_sale_price,
                 st_orig.payout as original_payout,
                 b.batch_name,
                 ct.name as coin_type_name,
                 u.username as resolved_by_username
          FROM refund_alerts ra
          LEFT JOIN sales_transactions st_refund ON ra.refund_transaction_id = st_refund.transaction_id
          LEFT JOIN sales_transactions st_orig ON ra.original_transaction_id = st_orig.transaction_id
          LEFT JOIN batches b ON ra.batch_id = b.batch_id
          LEFT JOIN coin_types ct ON ra.coin_type_id = ct.coin_type_id
          LEFT JOIN users u ON ra.resolved_by = u.user_id
          WHERE ra.alert_id = $1
        `, [alertId]);

        if (alertResult.rows.length === 0) {
          return res.status(404).json({ error: 'Alert not found' });
        }

        const alert = alertResult.rows[0];

        // Get member adjustments if this is a paid_batch alert
        let adjustments = [];
        if (alert.alert_type === 'paid_batch') {
          const adjResult = await query(`
            SELECT ma.*, u.username, u.full_name
            FROM member_adjustments ma
            JOIN users u ON ma.user_id = u.user_id
            WHERE ma.alert_id = $1
            ORDER BY ma.amount ASC
          `, [alertId]);
          adjustments = adjResult.rows;
        }

        // Get unassigned sales of this coin type (for suggestion)
        let unassignedSales = [];
        if (alert.coin_type_id) {
          const unassignedResult = await query(`
            SELECT transaction_id, order_number, item_title, sale_date, total_payout
            FROM sales_transactions
            WHERE coin_type_id = $1 AND batch_id IS NULL
              AND (is_refund IS NULL OR is_refund = false)
              AND (is_refunded IS NULL OR is_refunded = false)
            ORDER BY sale_date DESC
            LIMIT 10
          `, [alert.coin_type_id]);
          unassignedSales = unassignedResult.rows;
        }

        return res.json({ alert, adjustments, unassignedSales });
      }

      // List alerts
      let sql = `
        SELECT ra.*, 
               st_refund.item_title as refund_title,
               b.batch_name,
               ct.name as coin_type_name
        FROM refund_alerts ra
        LEFT JOIN sales_transactions st_refund ON ra.refund_transaction_id = st_refund.transaction_id
        LEFT JOIN batches b ON ra.batch_id = b.batch_id
        LEFT JOIN coin_types ct ON ra.coin_type_id = ct.coin_type_id
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (status !== 'all') {
        sql += ` AND ra.status = $${paramIndex}`;
        params.push(status);
        paramIndex++;
      }

      sql += ` ORDER BY 
        CASE ra.alert_type 
          WHEN 'paid_batch' THEN 1 
          WHEN 'orphan' THEN 2 
          WHEN 'unpaid_batch' THEN 3 
          WHEN 'unmapped' THEN 4 
        END,
        ra.created_at DESC`;

      const result = await query(sql, params);
      return res.json(result.rows);
    }

    // PUT - Update alert status or assign sale to batch
    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { alertId } = req.query;
      const { action, status, notes, transactionId } = req.body;

      if (!alertId) {
        return res.status(400).json({ error: 'Alert ID required' });
      }

      // Get alert details
      const alertResult = await query('SELECT * FROM refund_alerts WHERE alert_id = $1', [alertId]);
      if (alertResult.rows.length === 0) {
        return res.status(404).json({ error: 'Alert not found' });
      }
      const alert = alertResult.rows[0];

      // Assign an unassigned sale to the batch
      if (action === 'assignSale' && transactionId) {
        if (!alert.batch_id || !alert.coin_type_id) {
          return res.status(400).json({ error: 'Cannot assign - alert has no batch or coin type' });
        }

        // Get batch costs
        const batchCoin = await query(`
          SELECT cost_per_coin, grading_cost_per_coin 
          FROM batch_coins WHERE batch_id = $1 AND coin_type_id = $2
        `, [alert.batch_id, alert.coin_type_id]);

        const coinCost = parseFloat(batchCoin.rows[0]?.cost_per_coin) || 0;
        const gradingCost = parseFloat(batchCoin.rows[0]?.grading_cost_per_coin) || 0;

        // Get sale details
        const saleResult = await query('SELECT * FROM sales_transactions WHERE transaction_id = $1', [transactionId]);
        if (saleResult.rows.length === 0) {
          return res.status(404).json({ error: 'Sale not found' });
        }
        const sale = saleResult.rows[0];
        const qty = parseInt(sale.quantity_sold) || 1;
        const totalPayout = parseFloat(sale.total_payout) || 0;

        // Recalculate profit
        const totalCoinCost = coinCost * qty;
        const totalGradingCost = gradingCost * qty;
        const profit = totalPayout - totalCoinCost - totalGradingCost;
        const profitShare = Math.max(0.33 * profit, 8 * qty);
        const payout = Math.max(0, totalPayout - totalGradingCost - profitShare);

        // Update the sale with batch assignment
        await query(`
          UPDATE sales_transactions
          SET batch_id = $1, coin_cost = $2, grading_cost = $3, profit = $4, profit_share = $5, payout = $6
          WHERE transaction_id = $7
        `, [alert.batch_id, totalCoinCost, totalGradingCost, profit, profitShare, payout, transactionId]);

        // Update batch_coins sold count
        await query(`
          UPDATE batch_coins SET total_sold = total_sold + $1
          WHERE batch_id = $2 AND coin_type_id = $3
        `, [qty, alert.batch_id, alert.coin_type_id]);

        // Mark alert as resolved
        await query(`
          UPDATE refund_alerts 
          SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = $1,
              admin_notes = COALESCE(admin_notes || E'\\n', '') || $2
          WHERE alert_id = $3
        `, [user.userId, `Assigned sale ${transactionId} to batch`, alertId]);

        return res.json({ success: true, message: 'Sale assigned to batch and alert resolved' });
      }

      // Update status (resolve or dismiss)
      if (status) {
        await query(`
          UPDATE refund_alerts 
          SET status = $1, 
              resolved_at = CASE WHEN $1 IN ('resolved', 'dismissed') THEN CURRENT_TIMESTAMP ELSE resolved_at END,
              resolved_by = CASE WHEN $1 IN ('resolved', 'dismissed') THEN $2 ELSE resolved_by END,
              admin_notes = COALESCE($3, admin_notes)
          WHERE alert_id = $4
        `, [status, user.userId, notes, alertId]);

        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    // POST - Apply member adjustments to payouts
    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { action, alertId, adjustmentId } = req.body;

      // Apply all pending adjustments for an alert
      if (action === 'applyAdjustments' && alertId) {
        const adjustments = await query(
          `SELECT * FROM member_adjustments WHERE alert_id = $1 AND status = 'pending'`,
          [alertId]
        );

        if (adjustments.rows.length === 0) {
          return res.status(400).json({ error: 'No pending adjustments found' });
        }

        // Mark adjustments as applied (they will be deducted in payout calculations)
        await query(
          `UPDATE member_adjustments SET status = 'applied', applied_at = CURRENT_TIMESTAMP WHERE alert_id = $1`,
          [alertId]
        );

        // Update alert status
        await query(`
          UPDATE refund_alerts 
          SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, resolved_by = $1,
              admin_notes = COALESCE(admin_notes || E'\\n', '') || 'Adjustments applied to member balances'
          WHERE alert_id = $2
        `, [user.userId, alertId]);

        return res.json({ success: true, applied: adjustments.rows.length });
      }

      // Waive a single adjustment
      if (action === 'waiveAdjustment' && adjustmentId) {
        await query(
          `UPDATE member_adjustments SET status = 'waived' WHERE adjustment_id = $1`,
          [adjustmentId]
        );
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Refund alerts error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
