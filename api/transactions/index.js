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
      const { groupId, startDate, endDate, limit = 100, offset = 0 } = req.query;
      
      let sql = `
        SELECT st.*, g.group_name, gc.grade, gc.label_type as coin_label, mp.design, mp.mint_catalog_number
        FROM sales_transactions st
        JOIN groups g ON st.group_id = g.group_id
        LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
        LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
        WHERE 1=1
      `;
      const params = [];
      let paramIndex = 1;

      if (groupId) {
        sql += ` AND st.group_id = $${paramIndex}`;
        params.push(groupId);
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
      const countResult = await query('SELECT COUNT(*) as total FROM sales_transactions');

      return res.json({
        transactions: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { groupId, gradedCoinId, listingId, saleDate, salePrice, ebayFee, advertisingFee, shippingCost, coinCost, saleType, quantitySold, buyerUsername, notes } = req.body;

      const groupResult = await query(
        'SELECT profit_share_percentage, profit_share_minimum, profit_share_maximum FROM groups WHERE group_id = $1',
        [groupId]
      );
      if (groupResult.rows.length === 0) return res.status(400).json({ error: 'Group not found' });

      const group = groupResult.rows[0];
      const totalPayout = parseFloat(salePrice) - (parseFloat(ebayFee) || 0) - (parseFloat(advertisingFee) || 0) - (parseFloat(shippingCost) || 0);
      const profit = totalPayout - parseFloat(coinCost);
      
      let profitShare = profit * parseFloat(group.profit_share_percentage);
      profitShare = Math.max(profitShare, parseFloat(group.profit_share_minimum));
      if (group.profit_share_maximum) profitShare = Math.min(profitShare, parseFloat(group.profit_share_maximum));

      const result = await query(
        `INSERT INTO sales_transactions (group_id, graded_coin_id, listing_id, sale_date, sale_price, ebay_fee, advertising_fee, shipping_cost, total_payout, coin_cost, profit, profit_share, sale_type, quantity_sold, buyer_username, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING *`,
        [groupId, gradedCoinId || null, listingId, saleDate, salePrice, ebayFee || 0, advertisingFee || 0, shippingCost || 0, totalPayout, coinCost, profit, profitShare, saleType, quantitySold || 1, buyerUsername, notes]
      );
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Transactions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
