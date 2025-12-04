const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all payouts
router.get('/', authenticate, async (req, res) => {
  try {
    const { userId, groupId, status, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        p.*,
        u.username,
        u.full_name,
        g.group_name
      FROM payouts p
      JOIN users u ON p.user_id = u.user_id
      JOIN groups g ON p.group_id = g.group_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (userId) {
      query += ` AND p.user_id = $${paramIndex}`;
      params.push(userId);
      paramIndex++;
    }

    if (groupId) {
      query += ` AND p.group_id = $${paramIndex}`;
      params.push(groupId);
      paramIndex++;
    }

    if (status) {
      query += ` AND p.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY p.payout_date DESC, p.payout_id DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get amounts owed to each user (Payout Dashboard)
router.get('/owed', authenticate, async (req, res) => {
  try {
    const { groupId } = req.query;

    // Calculate what each user is owed based on their contribution percentage
    // and unpaid transactions
    let query = `
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
    `;

    const params = [];
    if (groupId) {
      query += ` AND g.group_id = $1`;
      params.push(groupId);
    }

    query += `
      GROUP BY u.user_id, u.username, u.full_name, g.group_id, g.group_name
      HAVING COALESCE(SUM(ut.profit_share * us.share_pct), 0) > 0
      ORDER BY g.group_name, amount_owed DESC
    `;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error calculating amounts owed:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get payout summary by group
router.get('/summary', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        g.group_id,
        g.group_name,
        COUNT(CASE WHEN p.status = 'Pending' THEN 1 END) as pending_count,
        COALESCE(SUM(CASE WHEN p.status = 'Pending' THEN p.amount END), 0) as pending_amount,
        COUNT(CASE WHEN p.status = 'Paid' THEN 1 END) as paid_count,
        COALESCE(SUM(CASE WHEN p.status = 'Paid' THEN p.amount END), 0) as paid_amount
      FROM groups g
      LEFT JOIN payouts p ON g.group_id = p.group_id
      GROUP BY g.group_id, g.group_name
      ORDER BY g.group_name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payout summary:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create payout
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId, groupId, amount, paymentMethod, paymentReference, notes } = req.body;

    const result = await db.query(`
      INSERT INTO payouts (user_id, group_id, payout_date, amount, status, payment_method, payment_reference, notes)
      VALUES ($1, $2, CURRENT_DATE, $3, 'Pending', $4, $5, $6)
      RETURNING *
    `, [userId, groupId, amount, paymentMethod, paymentReference, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating payout:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Mark payout as paid
router.put('/:id/pay', authenticate, requireAdmin, async (req, res) => {
  try {
    const { paymentMethod, paymentReference, notes } = req.body;

    const result = await db.query(`
      UPDATE payouts
      SET status = 'Paid',
          payment_method = COALESCE($1, payment_method),
          payment_reference = COALESCE($2, payment_reference),
          notes = COALESCE($3, notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE payout_id = $4
      RETURNING *
    `, [paymentMethod, paymentReference, notes, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error marking payout as paid:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Cancel payout
router.put('/:id/cancel', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE payouts
      SET status = 'Cancelled',
          updated_at = CURRENT_TIMESTAMP
      WHERE payout_id = $1 AND status = 'Pending'
      RETURNING *
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payout not found or already processed' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error cancelling payout:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update payout
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { amount, paymentMethod, paymentReference, notes, status } = req.body;

    const result = await db.query(`
      UPDATE payouts
      SET amount = COALESCE($1, amount),
          payment_method = COALESCE($2, payment_method),
          payment_reference = COALESCE($3, payment_reference),
          notes = COALESCE($4, notes),
          status = COALESCE($5, status)
      WHERE payout_id = $6
      RETURNING *
    `, [amount, paymentMethod, paymentReference, notes, status, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Payout not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating payout:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get payout history for reports
router.get('/history', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, groupId } = req.query;

    let query = `
      SELECT 
        p.payout_id,
        p.payout_date,
        p.amount,
        p.status,
        p.payment_method,
        u.username,
        u.full_name,
        g.group_name,
        g.grader
      FROM payouts p
      JOIN users u ON p.user_id = u.user_id
      JOIN groups g ON p.group_id = g.group_id
      WHERE p.status = 'Paid'
    `;
    const params = [];
    let paramIndex = 1;

    if (startDate) {
      query += ` AND p.payout_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND p.payout_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (groupId) {
      query += ` AND p.group_id = $${paramIndex}`;
      params.push(groupId);
    }

    query += ` ORDER BY p.payout_date DESC`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payout history:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
