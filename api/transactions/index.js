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
      const { batchId, coinTypeId, startDate, endDate, limit = 50, offset = 0 } = req.query;
      
      let sql = `
        SELECT 
          st.*,
          b.batch_name,
          ct.name as coin_type_name,
          ct.short_code
        FROM sales_transactions st
        LEFT JOIN batches b ON st.batch_id = b.batch_id
        LEFT JOIN coin_types ct ON st.coin_type_id = ct.coin_type_id
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (batchId) {
        sql += ` AND st.batch_id = $${paramIndex}`;
        params.push(batchId);
        paramIndex++;
      }
      if (coinTypeId) {
        sql += ` AND st.coin_type_id = $${paramIndex}`;
        params.push(coinTypeId);
        paramIndex++;
      }
      if (startDate) {
        sql += ` AND st.sale_date >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }
      if (endDate) {
        sql += ` AND st.sale_date <= $${paramIndex}`;
        params.push(endDate);
        paramIndex++;
      }

      sql += ` ORDER BY st.sale_date DESC, st.transaction_id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(parseInt(limit), parseInt(offset));

      const result = await query(sql, params);
      
      // Get total count with same filters
      let countSql = 'SELECT COUNT(*) as total FROM sales_transactions WHERE 1=1';
      const countParams = [];
      let countParamIndex = 1;
      
      if (batchId) {
        countSql += ` AND batch_id = $${countParamIndex}`;
        countParams.push(batchId);
        countParamIndex++;
      }
      if (coinTypeId) {
        countSql += ` AND coin_type_id = $${countParamIndex}`;
        countParams.push(coinTypeId);
        countParamIndex++;
      }
      if (startDate) {
        countSql += ` AND sale_date >= $${countParamIndex}`;
        countParams.push(startDate);
        countParamIndex++;
      }
      if (endDate) {
        countSql += ` AND sale_date <= $${countParamIndex}`;
        countParams.push(endDate);
        countParamIndex++;
      }
      
      const countResult = await query(countSql, countParams);

      // Get summary stats
      const summaryResult = await query(`
        SELECT 
          COUNT(*) as total_transactions,
          COALESCE(SUM(sale_price), 0) as total_revenue,
          COALESCE(SUM(profit), 0) as total_profit,
          COALESCE(SUM(profit_share), 0) as total_profit_share,
          COALESCE(SUM(payout), 0) as total_payout,
          COALESCE(SUM(quantity_sold), 0) as total_coins_sold
        FROM sales_transactions
      `);

      return res.json({
        transactions: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        summary: summaryResult.rows[0]
      });
    }

    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { transactionId } = req.query;
      if (!transactionId) {
        return res.status(400).json({ error: 'Transaction ID required' });
      }

      await query('DELETE FROM sales_transactions WHERE transaction_id = $1', [transactionId]);
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Transactions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
