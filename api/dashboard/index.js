import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

async function getStats() {
  const salesResult = await query(`
    SELECT 
      COUNT(*) as total_transactions,
      COALESCE(SUM(sale_price), 0) as total_revenue,
      COALESCE(SUM(profit), 0) as total_profit,
      COALESCE(SUM(profit_share), 0) as total_profit_share,
      COALESCE(AVG(profit), 0) as avg_profit
    FROM sales_transactions
  `);

  const pendingResult = await query(`
    SELECT COUNT(*) as pending_count, COALESCE(SUM(amount), 0) as pending_amount
    FROM payouts WHERE status = 'Pending'
  `);

  const paidResult = await query(`
    SELECT COUNT(*) as paid_count, COALESCE(SUM(amount), 0) as paid_amount
    FROM payouts WHERE status = 'Paid'
  `);

  const groupsResult = await query(`
    SELECT COUNT(*) as active_groups FROM groups WHERE status = 'Active'
  `);

  const usersResult = await query(`
    SELECT COUNT(DISTINCT user_id) as active_users FROM user_contributions
  `);

  return {
    sales: salesResult.rows[0],
    pendingPayouts: pendingResult.rows[0],
    paidPayouts: paidResult.rows[0],
    activeGroups: parseInt(groupsResult.rows[0].active_groups),
    activeUsers: parseInt(usersResult.rows[0].active_users)
  };
}

async function getSalesByGroup() {
  const result = await query(`
    SELECT 
      g.group_id,
      g.group_name,
      g.grader,
      COUNT(st.transaction_id) as transaction_count,
      COALESCE(SUM(st.sale_price), 0) as total_revenue,
      COALESCE(SUM(st.profit), 0) as total_profit,
      COALESCE(SUM(st.profit_share), 0) as total_profit_share
    FROM groups g
    LEFT JOIN sales_transactions st ON g.group_id = st.group_id
    GROUP BY g.group_id, g.group_name, g.grader
    ORDER BY total_revenue DESC
  `);
  return result.rows;
}

async function getSalesOverTime(groupBy = 'day') {
  let sql;
  if (groupBy === 'month') {
    sql = `
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
    sql = `
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
    sql = `
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
  const result = await query(sql);
  return result.rows;
}

async function getRecentTransactions(limit = 10) {
  const result = await query(`
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
  `, [parseInt(limit)]);
  return result.rows;
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, groupBy, limit } = req.query;

    switch (action) {
      case 'sales-by-group':
        return res.json(await getSalesByGroup());
      case 'sales-over-time':
        return res.json(await getSalesOverTime(groupBy));
      case 'recent-transactions':
        return res.json(await getRecentTransactions(limit));
      case 'stats':
      default:
        return res.json(await getStats());
    }
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
