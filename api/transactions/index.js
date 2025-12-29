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
      const { action, batchId, coinTypeId, startDate, endDate, limit = 50, offset = 0 } = req.query;

      // Get unique unmapped titles for bulk mapping - check this FIRST
      if (action === 'unmappedTitles') {
        const result = await query(`
          SELECT 
            item_title,
            COUNT(*) as count,
            SUM(sale_price) as total_revenue,
            MIN(sale_date) as first_sale,
            MAX(sale_date) as last_sale
          FROM sales_transactions
          WHERE coin_type_id IS NULL 
            AND COALESCE(is_refund, false) = false
            AND item_title IS NOT NULL
          GROUP BY item_title
          ORDER BY count DESC
        `);
        return res.json(result.rows);
      }
      
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
      if (coinTypeId === 'unmapped') {
        sql += ` AND st.coin_type_id IS NULL AND COALESCE(st.is_refund, false) = false`;
      } else if (coinTypeId) {
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
      if (coinTypeId === 'unmapped') {
        countSql += ` AND coin_type_id IS NULL AND COALESCE(is_refund, false) = false`;
      } else if (coinTypeId) {
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

      // Get unmapped count (always, for the warning badge)
      const unmappedResult = await query(`
        SELECT COUNT(*) as unmapped_count 
        FROM sales_transactions 
        WHERE coin_type_id IS NULL AND COALESCE(is_refund, false) = false
      `);

      // Get summary stats - apply same filters
      let summarySql = `
        SELECT 
          COUNT(*) FILTER (WHERE COALESCE(is_refund, false) = false) as total_transactions,
          COUNT(*) FILTER (WHERE is_refund = true) as refund_count,
          COALESCE(SUM(sale_price) FILTER (WHERE COALESCE(is_refund, false) = false), 0) as total_revenue,
          COALESCE(SUM(shipping_cost) FILTER (WHERE COALESCE(is_refund, false) = false), 0) as total_shipping,
          COALESCE(SUM(profit), 0) as total_profit,
          COALESCE(SUM(profit_share), 0) as total_profit_share,
          COALESCE(SUM(payout), 0) as total_payout,
          COALESCE(SUM(quantity_sold) FILTER (WHERE COALESCE(is_refund, false) = false), 0) as total_coins_sold,
          COALESCE(SUM(payout) FILTER (WHERE is_refund = true), 0) as refund_total,
          COALESCE(SUM(coin_cost) FILTER (WHERE COALESCE(is_refund, false) = false), 0) as total_cost
        FROM sales_transactions
        WHERE 1=1
      `;
      const summaryParams = [];
      let summaryParamIndex = 1;
      
      if (batchId) {
        summarySql += ` AND batch_id = $${summaryParamIndex}`;
        summaryParams.push(batchId);
        summaryParamIndex++;
      }
      if (coinTypeId === 'unmapped') {
        summarySql += ` AND coin_type_id IS NULL AND COALESCE(is_refund, false) = false`;
      } else if (coinTypeId) {
        summarySql += ` AND coin_type_id = $${summaryParamIndex}`;
        summaryParams.push(coinTypeId);
        summaryParamIndex++;
      }
      if (startDate) {
        summarySql += ` AND sale_date >= $${summaryParamIndex}`;
        summaryParams.push(startDate);
        summaryParamIndex++;
      }
      if (endDate) {
        summarySql += ` AND sale_date <= $${summaryParamIndex}`;
        summaryParams.push(endDate);
        summaryParamIndex++;
      }
      
      const summaryResult = await query(summarySql, summaryParams);

      return res.json({
        transactions: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit: parseInt(limit),
        offset: parseInt(offset),
        summary: summaryResult.rows[0],
        unmappedCount: parseInt(unmappedResult.rows[0].unmapped_count),
        filtered: !!(coinTypeId || startDate || endDate || batchId)
      });
    }

    // PUT - Edit transaction or bulk mappings
    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { transactionId } = req.query;
      
      // Single transaction edit
      if (transactionId) {
        const { coinTypeId, saleDate, salePrice, ebayFee, advertisingFee, shippingCost, coinCost, grade, quantitySold } = req.body;
        
        // Calculate derived values
        const totalPayout = (parseFloat(salePrice) || 0) - (parseFloat(ebayFee) || 0) - (parseFloat(advertisingFee) || 0) - (parseFloat(shippingCost) || 0);
        const profit = totalPayout - (parseFloat(coinCost) || 0);
        const profitShare = profit > 0 ? Math.max(0.33 * profit, 8) : 0;
        const memberPayout = profit > 0 ? profit - profitShare : 0;
        const profitMargin = parseFloat(salePrice) > 0 ? profit / parseFloat(salePrice) : 0;
        
        await query(`
          UPDATE sales_transactions
          SET 
            coin_type_id = $1,
            sale_date = $2,
            sale_price = $3,
            ebay_fee = $4,
            advertising_fee = $5,
            shipping_cost = $6,
            coin_cost = $7,
            grade = $8,
            quantity_sold = $9,
            total_payout = $10,
            profit = $11,
            profit_share = $12,
            payout = $13,
            profit_margin = $14
          WHERE transaction_id = $15
        `, [
          coinTypeId || null,
          saleDate,
          salePrice,
          ebayFee,
          advertisingFee,
          shippingCost,
          coinCost,
          grade || null,
          quantitySold,
          totalPayout,
          profit,
          profitShare,
          memberPayout,
          profitMargin,
          transactionId
        ]);
        
        return res.json({ success: true });
      }
      
      // Bulk mappings
      const { mappings } = req.body; // { "item_title": coinTypeId, ... }
      
      if (!mappings || typeof mappings !== 'object') {
        return res.status(400).json({ error: 'Mappings object required' });
      }

      let updated = 0;
      
      for (const [itemTitle, coinTypeId] of Object.entries(mappings)) {
        if (!coinTypeId) continue;
        
        // Get cost_per_coin and grading_cost_per_coin for this coin type from batch_coins
        const batchCoin = await query(`
          SELECT bc.batch_id, bc.cost_per_coin, bc.grading_cost_per_coin
          FROM batch_coins bc
          JOIN batches b ON bc.batch_id = b.batch_id
          WHERE bc.coin_type_id = $1 
            AND bc.cost_per_coin IS NOT NULL
          ORDER BY b.ship_date ASC NULLS LAST, b.created_at ASC
          LIMIT 1
        `, [coinTypeId]);
        
        // Total cost = coin cost + grading cost
        const baseCost = batchCoin.rows.length > 0 ? parseFloat(batchCoin.rows[0].cost_per_coin) || 0 : 0;
        const gradingCost = batchCoin.rows.length > 0 ? parseFloat(batchCoin.rows[0].grading_cost_per_coin) || 0 : 0;
        const coinCost = baseCost + gradingCost;
        const batchId = batchCoin.rows.length > 0 ? batchCoin.rows[0].batch_id : null;
        
        // Update all sales with this title
        const updateResult = await query(`
          UPDATE sales_transactions
          SET 
            coin_type_id = $1,
            batch_id = $2,
            coin_cost = $3 * quantity_sold,
            profit = total_payout - ($3 * quantity_sold),
            profit_share = CASE 
              WHEN total_payout - ($3 * quantity_sold) > 0 
              THEN GREATEST(0.33 * (total_payout - ($3 * quantity_sold)), 8)
              ELSE 0 
            END,
            payout = CASE 
              WHEN total_payout - ($3 * quantity_sold) > 0 
              THEN (total_payout - ($3 * quantity_sold)) - GREATEST(0.33 * (total_payout - ($3 * quantity_sold)), 8)
              ELSE 0 
            END,
            profit_margin = CASE 
              WHEN sale_price > 0 
              THEN (total_payout - ($3 * quantity_sold)) / sale_price
              ELSE 0 
            END
          WHERE item_title = $4
            AND coin_type_id IS NULL
            AND COALESCE(is_refund, false) = false
        `, [coinTypeId, batchId, coinCost, itemTitle]);
        
        updated += updateResult.rowCount;
      }

      // Update batch_coins sold counts
      await query(`
        UPDATE batch_coins bc
        SET total_sold = (
          SELECT COALESCE(SUM(st.quantity_sold), 0)
          FROM sales_transactions st
          WHERE st.coin_type_id = bc.coin_type_id
            AND COALESCE(st.is_refund, false) = false
        )
      `);

      return res.json({ success: true, updated });
    }

    // Create a new sale (for testing)
    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { 
        batchId, 
        coinTypeId, 
        itemTitle, 
        saleDate, 
        salePrice, 
        ebayFee, 
        advertisingFee, 
        shippingCost, 
        quantitySold,
        grade 
      } = req.body;

      if (!batchId || !coinTypeId || !saleDate || !salePrice) {
        return res.status(400).json({ error: 'Batch, coin type, date, and price are required' });
      }

      const result = await query(`
        INSERT INTO sales_transactions (
          batch_id, coin_type_id, item_title, sale_date, sale_price,
          ebay_fee, advertising_fee, shipping_cost, quantity_sold, grade
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING transaction_id
      `, [
        batchId,
        coinTypeId,
        itemTitle || 'Test Sale',
        saleDate,
        salePrice,
        ebayFee || 0,
        advertisingFee || 0,
        shippingCost || 0,
        quantitySold || 1,
        grade || null
      ]);

      // Update batch_coins sold counts
      await query(`
        UPDATE batch_coins bc
        SET total_sold = (
          SELECT COALESCE(SUM(st.quantity_sold), 0)
          FROM sales_transactions st
          WHERE st.coin_type_id = bc.coin_type_id
            AND COALESCE(st.is_refund, false) = false
        )
        WHERE bc.coin_type_id = $1
      `, [coinTypeId]);

      return res.json({ success: true, transactionId: result.rows[0].transaction_id });
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
