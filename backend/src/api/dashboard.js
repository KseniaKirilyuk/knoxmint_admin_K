const express = require('express');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Get dashboard overview stats
router.get('/stats', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = ' AND sale_date BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    }

    // Total sales
    const salesResult = await db.query(`
      SELECT 
        COUNT(*) as total_transactions,
        COALESCE(SUM(sale_price), 0) as total_revenue,
        COALESCE(SUM(profit), 0) as total_profit,
        COALESCE(SUM(profit_share), 0) as total_profit_share,
        COALESCE(AVG(profit), 0) as avg_profit
      FROM sales_transactions
      WHERE 1=1 ${dateFilter}
    `, params);

    // Pending payouts
    const pendingResult = await db.query(`
      SELECT 
        COUNT(*) as pending_count,
        COALESCE(SUM(amount), 0) as pending_amount
      FROM payouts
      WHERE status = 'Pending'
    `);

    // Paid payouts
    const paidResult = await db.query(`
      SELECT 
        COUNT(*) as paid_count,
        COALESCE(SUM(amount), 0) as paid_amount
      FROM payouts
      WHERE status = 'Paid'
    `);

    // Active groups
    const groupsResult = await db.query(`
      SELECT COUNT(*) as active_groups
      FROM groups
      WHERE status = 'Active'
    `);

    // Active users
    const usersResult = await db.query(`
      SELECT COUNT(DISTINCT user_id) as active_users
      FROM user_contributions
    `);

    res.json({
      sales: salesResult.rows[0],
      pendingPayouts: pendingResult.rows[0],
      paidPayouts: paidResult.rows[0],
      activeGroups: parseInt(groupsResult.rows[0].active_groups),
      activeUsers: parseInt(usersResult.rows[0].active_users)
    });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get sales by group
router.get('/sales-by-group', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const params = [];

    if (startDate && endDate) {
      dateFilter = ' AND st.sale_date BETWEEN $1 AND $2';
      params.push(startDate, endDate);
    }

    const result = await db.query(`
      SELECT 
        g.group_id,
        g.group_name,
        g.grader,
        COUNT(st.transaction_id) as transaction_count,
        COALESCE(SUM(st.sale_price), 0) as total_revenue,
        COALESCE(SUM(st.profit), 0) as total_profit,
        COALESCE(SUM(st.profit_share), 0) as total_profit_share
      FROM groups g
      LEFT JOIN sales_transactions st ON g.group_id = st.group_id ${dateFilter ? 'AND st.sale_date BETWEEN $1 AND $2' : ''}
      GROUP BY g.group_id, g.group_name, g.grader
      ORDER BY total_revenue DESC
    `, params);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sales by group:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get sales over time (for charts)
router.get('/sales-over-time', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    let dateFormat;
    switch (groupBy) {
      case 'month':
        dateFormat = "TO_CHAR(sale_date, 'YYYY-MM')";
        break;
      case 'week':
        dateFormat = "TO_CHAR(DATE_TRUNC('week', sale_date), 'YYYY-MM-DD')";
        break;
      default:
        dateFormat = "TO_CHAR(sale_date, 'YYYY-MM-DD')";
    }

    let query = `
      SELECT 
        ${dateFormat} as period,
        COUNT(*) as transaction_count,
        SUM(sale_price) as revenue,
        SUM(profit) as profit
      FROM sales_transactions
      WHERE 1=1
    `;
    const params = [];

    if (startDate) {
      params.push(startDate);
      query += ` AND sale_date >= $${params.length}`;
    }

    if (endDate) {
      params.push(endDate);
      query += ` AND sale_date <= $${params.length}`;
    }

    query += ` GROUP BY ${dateFormat} ORDER BY period`;

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching sales over time:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get top users by sales
router.get('/top-users', authenticate, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await db.query(`
      SELECT 
        u.user_id,
        u.username,
        u.full_name,
        COALESCE(SUM(p.amount), 0) as total_earned,
        COUNT(DISTINCT p.payout_id) as payout_count
      FROM users u
      LEFT JOIN payouts p ON u.user_id = p.user_id AND p.status = 'Paid'
      WHERE u.role = 'user'
      GROUP BY u.user_id, u.username, u.full_name
      ORDER BY total_earned DESC
      LIMIT $1
    `, [limit]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching top users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get recent transactions
router.get('/recent-transactions', authenticate, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const result = await db.query(`
      SELECT 
        st.transaction_id,
        st.listing_id,
        st.sale_date,
        st.sale_price,
        st.profit,
        g.group_name,
        mp.design,
        gc.grade
      FROM sales_transactions st
      JOIN groups g ON st.group_id = g.group_id
      LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
      LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
      ORDER BY st.sale_date DESC, st.transaction_id DESC
      LIMIT $1
    `, [limit]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recent transactions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get profit by coin type
router.get('/profit-by-coin', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        mp.design,
        mp.mint_catalog_number,
        gc.grade,
        COUNT(st.transaction_id) as sales_count,
        COALESCE(SUM(st.sale_price), 0) as total_revenue,
        COALESCE(SUM(st.profit), 0) as total_profit,
        COALESCE(AVG(st.profit), 0) as avg_profit
      FROM sales_transactions st
      LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
      LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
      GROUP BY mp.design, mp.mint_catalog_number, gc.grade
      ORDER BY total_profit DESC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching profit by coin:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
