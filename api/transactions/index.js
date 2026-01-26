import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

// Parse grade from eBay item title - looks for MS70, MS69, PR70, PR69, etc.
function parseGradeFromTitle(title) {
  if (!title) return null;
  // Match patterns like MS70, MS69, PR70, PR69 (case insensitive)
  const match = title.match(/\b(?:MS|PR)\s*(70|69)\b/i);
  if (match) {
    return match[1]; // Returns '70' or '69'
  }
  return null; // No grade found = ungraded
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    if (req.method === 'GET') {
      const { action, batchId, coinTypeId, startDate, endDate, search, refundStatus = 'active', limit = 50, offset = 0 } = req.query;

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
          ct.short_code,
          ct.is_ungraded,
          bc.cost_per_coin as unit_coin_cost,
          bc.grading_cost_per_coin as unit_grading_cost
        FROM sales_transactions st
        LEFT JOIN batches b ON st.batch_id = b.batch_id
        LEFT JOIN coin_types ct ON st.coin_type_id = ct.coin_type_id
        LEFT JOIN batch_coins bc ON st.batch_id = bc.batch_id 
          AND st.coin_type_id = bc.coin_type_id
          AND (st.grade = bc.grade OR (st.grade IS NULL AND bc.grade IS NULL))
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
      if (search) {
        sql += ` AND (st.order_number ILIKE $${paramIndex} OR st.listing_id ILIKE $${paramIndex} OR st.item_title ILIKE $${paramIndex})`;
        params.push(`%${search}%`);
        paramIndex++;
      }
      // Refund status filter
      if (refundStatus === 'active') {
        sql += ` AND COALESCE(st.is_refunded, false) = false AND COALESCE(st.is_refund, false) = false`;
      } else if (refundStatus === 'refunded') {
        // Show both refunded sales AND their refund rows together
        sql += ` AND (st.is_refunded = true OR st.is_refund = true)`;
      }
      // 'all' shows everything

      // For 'all' or 'refunded': group by order_number to keep refunds with originals
      // Order: order_number groups together, then original sale (is_refund=false) before refund row (is_refund=true)
      if (refundStatus === 'all' || refundStatus === 'refunded') {
        sql += ` ORDER BY st.order_number DESC, COALESCE(st.is_refund, false) ASC, st.sale_date DESC, st.transaction_id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      } else {
        sql += ` ORDER BY st.sale_date DESC, st.transaction_id DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      }
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
      if (search) {
        countSql += ` AND (order_number ILIKE $${countParamIndex} OR listing_id ILIKE $${countParamIndex} OR item_title ILIKE $${countParamIndex})`;
        countParams.push(`%${search}%`);
        countParamIndex++;
      }
      // Refund status filter
      if (refundStatus === 'active') {
        countSql += ` AND COALESCE(is_refunded, false) = false AND COALESCE(is_refund, false) = false`;
      } else if (refundStatus === 'refunded') {
        // Show both refunded sales AND their refund rows together
        countSql += ` AND (is_refunded = true OR is_refund = true)`;
      }
      
      const countResult = await query(countSql, countParams);

      // Get unmapped count (always, for the warning badge)
      const unmappedResult = await query(`
        SELECT COUNT(*) as unmapped_count 
        FROM sales_transactions 
        WHERE coin_type_id IS NULL AND COALESCE(is_refund, false) = false
      `);

      // Get summary stats - apply same filters (exclude refunds AND refunded sales)
      let summarySql = `
        SELECT 
          COUNT(*) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false) as total_transactions,
          COUNT(*) FILTER (WHERE is_refunded = true) as refund_count,
          COALESCE(SUM(sale_price) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_revenue,
          COALESCE(SUM(shipping_cost) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_shipping,
          COALESCE(SUM(profit) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_profit,
          COALESCE(SUM(profit_share) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_profit_share,
          COALESCE(SUM(payout) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_payout,
          COALESCE(SUM(quantity_sold) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_coins_sold,
          COALESCE(SUM(coin_cost) FILTER (WHERE COALESCE(is_refund, false) = false AND COALESCE(is_refunded, false) = false), 0) as total_cost
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
      if (search) {
        summarySql += ` AND (order_number ILIKE $${summaryParamIndex} OR listing_id ILIKE $${summaryParamIndex} OR item_title ILIKE $${summaryParamIndex})`;
        summaryParams.push(`%${search}%`);
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
        filtered: !!(coinTypeId || startDate || endDate || batchId || search || refundStatus !== 'active')
      });
    }

    // PUT - Edit transaction or bulk mappings
    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { transactionId } = req.query;
      
      // Single transaction edit
      if (transactionId) {
        const { batchId, coinTypeId, saleDate, salePrice, ebayFee, advertisingFee, shippingCost, coinCost, grade, quantitySold } = req.body;
        
        // Get old batch_id to update sold counts later
        const oldTx = await query('SELECT batch_id, coin_type_id, grade, quantity_sold FROM sales_transactions WHERE transaction_id = $1', [transactionId]);
        const oldBatchId = oldTx.rows[0]?.batch_id;
        const oldCoinTypeId = oldTx.rows[0]?.coin_type_id;
        const oldGrade = oldTx.rows[0]?.grade;
        const oldQty = oldTx.rows[0]?.quantity_sold || 1;
        
        // Get costs from new batch if batch is assigned
        let actualCoinCost = parseFloat(coinCost) || 0;
        let gradingCost = 0;
        
        if (batchId && coinTypeId) {
          const batchCoinResult = await query(`
            SELECT cost_per_coin, grading_cost_per_coin 
            FROM batch_coins 
            WHERE batch_id = $1 AND coin_type_id = $2
              AND (grade = $3 OR (grade IS NULL AND $3 IS NULL))
          `, [batchId, coinTypeId, grade || null]);
          
          if (batchCoinResult.rows.length > 0) {
            const qty = parseInt(quantitySold) || 1;
            actualCoinCost = (parseFloat(batchCoinResult.rows[0].cost_per_coin) || 0) * qty;
            gradingCost = (parseFloat(batchCoinResult.rows[0].grading_cost_per_coin) || 0) * qty;
          }
        }
        
        // Calculate derived values
        const qty = parseInt(quantitySold) || 1;
        const totalPayout = (parseFloat(salePrice) || 0) - (parseFloat(ebayFee) || 0) - (parseFloat(advertisingFee) || 0) - (parseFloat(shippingCost) || 0);
        const profit = totalPayout - actualCoinCost - gradingCost;
        const profitShare = Math.max(0.33 * profit, 8 * qty);
        const memberPayout = Math.max(0, totalPayout - gradingCost - profitShare);
        const profitMargin = parseFloat(salePrice) > 0 ? profit / parseFloat(salePrice) : 0;
        
        await query(`
          UPDATE sales_transactions
          SET 
            batch_id = $1,
            coin_type_id = $2,
            sale_date = $3,
            sale_price = $4,
            ebay_fee = $5,
            advertising_fee = $6,
            shipping_cost = $7,
            coin_cost = $8,
            grading_cost = $9,
            grade = $10,
            quantity_sold = $11,
            total_payout = $12,
            profit = $13,
            profit_share = $14,
            payout = $15,
            profit_margin = $16
          WHERE transaction_id = $17
        `, [
          batchId || null,
          coinTypeId || null,
          saleDate,
          salePrice,
          ebayFee,
          advertisingFee,
          shippingCost,
          actualCoinCost,
          gradingCost,
          grade || null,
          quantitySold,
          totalPayout,
          profit,
          profitShare,
          memberPayout,
          profitMargin,
          transactionId
        ]);
        
        // Update batch_coins sold counts if batch/coin/grade changed
        const newGrade = grade || null;
        if (oldBatchId !== (batchId ? parseInt(batchId) : null) || 
            oldCoinTypeId !== (coinTypeId ? parseInt(coinTypeId) : null) ||
            oldGrade !== newGrade) {
          // Decrease old batch count
          if (oldBatchId && oldCoinTypeId) {
            await query(`
              UPDATE batch_coins SET total_sold = GREATEST(0, total_sold - $1)
              WHERE batch_id = $2 AND coin_type_id = $3
                AND (grade = $4 OR (grade IS NULL AND $4 IS NULL))
            `, [oldQty, oldBatchId, oldCoinTypeId, oldGrade]);
          }
          // Increase new batch count
          if (batchId && coinTypeId) {
            await query(`
              UPDATE batch_coins SET total_sold = total_sold + $1
              WHERE batch_id = $2 AND coin_type_id = $3
                AND (grade = $4 OR (grade IS NULL AND $4 IS NULL))
            `, [qty, batchId, coinTypeId, newGrade]);
          }
        }
        
        return res.json({ success: true });
      }
      
      // Bulk mappings
      const { mappings } = req.body; // { "item_title": coinTypeId, ... }
      
      if (!mappings || typeof mappings !== 'object') {
        return res.status(400).json({ error: 'Mappings object required' });
      }

      let updated = 0;
      
      // Track assigned quantities during this mapping operation
      const assignedDuringMapping = {};
      
      for (const [itemTitle, rawCoinTypeId] of Object.entries(mappings)) {
        if (!rawCoinTypeId) continue;
        
        // Ensure coinTypeId is an integer
        const coinTypeId = parseInt(rawCoinTypeId);
        if (isNaN(coinTypeId)) {
          console.error(`Invalid coinTypeId for "${itemTitle}": ${rawCoinTypeId}`);
          continue;
        }
        
        // Parse grade from item title
        const grade = parseGradeFromTitle(itemTitle);
        
        // Get all unmapped sales with this title
        const unmappedSales = await query(`
          SELECT transaction_id, quantity_sold, total_payout, sale_price
          FROM sales_transactions
          WHERE item_title = $1
            AND coin_type_id IS NULL
            AND COALESCE(is_refund, false) = false
        `, [itemTitle]);
        
        // Get all batches with this coin type AND grade (ordered by date for FIFO)
        const batches = await query(`
          SELECT bc.batch_id, bc.cost_per_coin, bc.grading_cost_per_coin, bc.total_contributed, bc.total_sold, bc.grade
          FROM batch_coins bc
          JOIN batches b ON bc.batch_id = b.batch_id
          WHERE bc.coin_type_id = $1 
            AND bc.cost_per_coin IS NOT NULL
            AND (bc.grade = $2 OR (bc.grade IS NULL AND $2 IS NULL))
          ORDER BY b.ship_date ASC NULLS LAST, b.created_at ASC
        `, [coinTypeId, grade]);
        
        // Process each sale individually
        for (const sale of unmappedSales.rows) {
          const quantity = parseInt(sale.quantity_sold) || 1;
          
          // Find first batch with available inventory
          let selectedBatch = null;
          for (const bc of batches.rows) {
            const key = `${bc.batch_id}-${coinTypeId}-${grade || 'null'}`;
            const alreadyAssigned = assignedDuringMapping[key] || 0;
            const totalSoldIncludingMapping = parseInt(bc.total_sold) + alreadyAssigned;
            const available = parseInt(bc.total_contributed) - totalSoldIncludingMapping;
            
            if (available >= quantity) {
              selectedBatch = bc;
              // Track this assignment
              assignedDuringMapping[key] = alreadyAssigned + quantity;
              break;
            }
          }
          
          // Get costs (0 if no batch available)
          const coinCost = selectedBatch ? parseFloat(selectedBatch.cost_per_coin) || 0 : 0;
          const gradingCost = selectedBatch ? parseFloat(selectedBatch.grading_cost_per_coin) || 0 : 0;
          const batchId = selectedBatch ? selectedBatch.batch_id : null;
          const totalCostPerCoin = coinCost + gradingCost;
          
          // Calculate payout values
          const totalPayout = parseFloat(sale.total_payout) || 0;
          const salePrice = parseFloat(sale.sale_price) || 0;
          const totalCoinCost = totalCostPerCoin * quantity;
          const totalGradingCost = gradingCost * quantity;
          const profit = totalPayout - totalGradingCost - (coinCost * quantity);
          const profitShare = Math.max(0.33 * profit, 8 * quantity);
          const payout = totalPayout - totalGradingCost - profitShare;
          const profitMargin = salePrice > 0 ? profit / salePrice : 0;
          
          // Update this sale with grade
          await query(`
            UPDATE sales_transactions
            SET 
              coin_type_id = $1,
              batch_id = $2,
              grade = $3,
              coin_cost = $4,
              profit = $5,
              profit_share = $6,
              payout = $7,
              profit_margin = $8
            WHERE transaction_id = $9
          `, [coinTypeId, batchId, grade, totalCoinCost, profit, profitShare, payout, profitMargin, sale.transaction_id]);
          
          updated++;
        }
      }

      // Update batch_coins sold counts by grade
      await query(`
        UPDATE batch_coins bc
        SET total_sold = (
          SELECT COALESCE(SUM(st.quantity_sold), 0)
          FROM sales_transactions st
          WHERE st.batch_id = bc.batch_id
            AND st.coin_type_id = bc.coin_type_id
            AND (st.grade = bc.grade OR (st.grade IS NULL AND bc.grade IS NULL))
            AND COALESCE(st.is_refund, false) = false
        )
      `);

      return res.json({ success: true, updated });
    }

    // Create a new sale (for testing) or run migrations
    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { action } = req.body;
      
      // Migration: Fix profit calculations to include grading cost
      if (action === 'fixProfitCalculations') {
        // Step 1: Add grading_cost column if not exists
        await query(`ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS grading_cost DECIMAL(10,2) DEFAULT 0`);
        
        // Step 2: Get all sales with their batch grading costs
        const salesResult = await query(`
          SELECT 
            st.transaction_id,
            st.batch_id,
            st.coin_type_id,
            st.total_payout,
            st.coin_cost,
            st.quantity_sold,
            st.profit as old_profit,
            COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin
          FROM sales_transactions st
          LEFT JOIN batch_coins bc ON st.batch_id = bc.batch_id AND st.coin_type_id = bc.coin_type_id
          WHERE COALESCE(st.is_refund, false) = false
        `);
        
        // Step 3: Recalculate each sale
        let updated = 0;
        let unchanged = 0;
        
        for (const sale of salesResult.rows) {
          const totalPayout = parseFloat(sale.total_payout) || 0;
          const coinCost = parseFloat(sale.coin_cost) || 0;
          const gradingCostPerCoin = parseFloat(sale.grading_cost_per_coin) || 0;
          const quantity = parseInt(sale.quantity_sold) || 1;
          
          const totalGradingCost = gradingCostPerCoin * quantity;
          const newProfit = totalPayout - coinCost - totalGradingCost;
          const newProfitShare = Math.max(0.33 * newProfit, 8 * quantity);
          const newPayout = totalPayout - totalGradingCost - newProfitShare;
          const newProfitMargin = totalPayout > 0 ? (newProfit / totalPayout) : 0;
          
          const oldProfit = parseFloat(sale.old_profit) || 0;
          if (Math.abs(newProfit - oldProfit) > 0.01) {
            await query(`
              UPDATE sales_transactions 
              SET grading_cost = $1, profit = $2, profit_share = $3, payout = $4, profit_margin = $5
              WHERE transaction_id = $6
            `, [totalGradingCost, newProfit, newProfitShare, newPayout, newProfitMargin, sale.transaction_id]);
            updated++;
          } else {
            unchanged++;
          }
        }
        
        return res.json({ 
          success: true, 
          message: `Migration complete. Updated: ${updated}, Unchanged: ${unchanged}`,
          updated,
          unchanged
        });
      }
      
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

      // Get cost per coin from batch_coins (separate coin cost and grading cost) - match by grade
      const costResult = await query(`
        SELECT 
          COALESCE(cost_per_coin, 0) as coin_cost,
          COALESCE(grading_cost_per_coin, 0) as grading_cost
        FROM batch_coins
        WHERE batch_id = $1 AND coin_type_id = $2
          AND (grade = $3 OR (grade IS NULL AND $3 IS NULL))
      `, [batchId, coinTypeId, grade || null]);

      const coinCostPerUnit = costResult.rows.length > 0 ? parseFloat(costResult.rows[0].coin_cost) : 0;
      const gradingCostPerUnit = costResult.rows.length > 0 ? parseFloat(costResult.rows[0].grading_cost) : 0;
      const qty = parseInt(quantitySold) || 1;
      
      // Calculate payout
      // Net from sale = Sale price - eBay fee - Ads - Shipping
      // Profit = Net - Grading cost - Coin cost
      // Business share = max(33% × Profit, $8) - ALWAYS at least $8
      // Contributor gets = Net - Grading cost - Business share
      const price = parseFloat(salePrice) || 0;
      const fees = (parseFloat(ebayFee) || 0) + (parseFloat(advertisingFee) || 0) + (parseFloat(shippingCost) || 0);
      const totalPayout = price - fees;  // Net from sale
      const totalGradingCost = gradingCostPerUnit * qty;
      const totalCoinCost = coinCostPerUnit * qty;
      const profit = totalPayout - totalGradingCost - totalCoinCost;
      const profitShare = Math.max(0.33 * profit, 8 * qty);  // Always at least $8 per coin
      const memberPayout = totalPayout - totalGradingCost - profitShare;  // Net - grading - business share
      const margin = price > 0 ? (profit / price) : 0;

      const result = await query(`
        INSERT INTO sales_transactions (
          batch_id, coin_type_id, item_title, sale_date, sale_price,
          ebay_fee, advertising_fee, shipping_cost, quantity_sold, grade,
          total_payout, coin_cost, profit, profit_share, payout, profit_margin
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING transaction_id
      `, [
        batchId,
        coinTypeId,
        itemTitle || 'Test Sale',
        saleDate,
        price,
        parseFloat(ebayFee) || 0,
        parseFloat(advertisingFee) || 0,
        parseFloat(shippingCost) || 0,
        qty,
        grade || null,
        totalPayout,
        totalCoinCost + totalGradingCost,  // Store combined cost for reference
        profit,
        profitShare,
        memberPayout,
        margin
      ]);

      // Update batch_coins sold counts by grade
      await query(`
        UPDATE batch_coins bc
        SET total_sold = (
          SELECT COALESCE(SUM(st.quantity_sold), 0)
          FROM sales_transactions st
          WHERE st.batch_id = bc.batch_id
            AND st.coin_type_id = bc.coin_type_id
            AND (st.grade = bc.grade OR (st.grade IS NULL AND bc.grade IS NULL))
            AND COALESCE(st.is_refund, false) = false
        )
        WHERE bc.coin_type_id = $1
          AND (bc.grade = $2 OR (bc.grade IS NULL AND $2 IS NULL))
      `, [coinTypeId, grade || null]);

      return res.json({ 
        success: true, 
        transactionId: result.rows[0].transaction_id,
        calculated: { 
          coinCost: totalCoinCost, 
          gradingCost: totalGradingCost,
          profit, 
          profitShare, 
          memberPayout 
        }
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
