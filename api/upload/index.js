import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

// Ensure refund columns exist (idempotent)
async function ensureRefundColumns() {
  try {
    await query(`ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS is_refund BOOLEAN DEFAULT false`);
    await query(`ALTER TABLE sales_transactions ADD COLUMN IF NOT EXISTS is_refunded BOOLEAN DEFAULT false`);
  } catch (e) {
    // Ignore - columns may already exist
  }
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

  // Handle DELETE - clear all sales
  if (req.method === 'DELETE') {
    const { action } = req.query;
    if (action === 'clearAll') {
      try {
        await query('DELETE FROM sales_transactions');
        // Reset batch_coins sold counts
        await query('UPDATE batch_coins SET total_sold = 0');
        return res.json({ success: true, message: 'All sales transactions cleared' });
      } catch (error) {
        return res.status(500).json({ error: 'Failed to clear sales: ' + error.message });
      }
    }
    return res.status(400).json({ error: 'Invalid action' });
  }

  // Handle PUT - reassign batches
  if (req.method === 'PUT') {
    const { action } = req.query;
    if (action === 'reassignBatches') {
      try {
        // Find all sales without batch_id but with coin_type_id
        const unmappedSales = await query(`
          SELECT transaction_id, coin_type_id, quantity_sold
          FROM sales_transactions
          WHERE batch_id IS NULL AND coin_type_id IS NOT NULL
        `);
        
        let reassigned = 0;
        let notFound = 0;
        
        for (const sale of unmappedSales.rows) {
          // Find batch with this coin type that has cost set and available inventory
          const batchResult = await query(`
            SELECT bc.batch_id, bc.cost_per_coin, bc.grading_cost_per_coin
            FROM batch_coins bc
            JOIN batches b ON bc.batch_id = b.batch_id
            WHERE bc.coin_type_id = $1 
              AND bc.cost_per_coin IS NOT NULL
              AND bc.total_sold < bc.total_contributed
            ORDER BY b.ship_date ASC NULLS LAST, b.created_at ASC
            LIMIT 1
          `, [sale.coin_type_id]);
          
          if (batchResult.rows.length > 0) {
            const batch = batchResult.rows[0];
            const coinCost = parseFloat(batch.cost_per_coin) || 0;
            const gradingCost = parseFloat(batch.grading_cost_per_coin) || 0;
            const quantity = parseInt(sale.quantity_sold) || 1;
            
            // Get sale details to recalculate
            const saleDetails = await query(`
              SELECT total_payout FROM sales_transactions WHERE transaction_id = $1
            `, [sale.transaction_id]);
            
            const totalPayout = parseFloat(saleDetails.rows[0]?.total_payout) || 0;
            const totalCoinCost = coinCost * quantity;
            const totalGradingCost = gradingCost * quantity;
            
            // Recalculate profit with correct costs
            const profit = totalPayout - totalCoinCost - totalGradingCost;
            const profitShare = Math.max(0.33 * profit, 8 * quantity);
            const payout = Math.max(0, totalPayout - totalGradingCost - profitShare);
            
            // Update the sale with batch and recalculated values
            await query(`
              UPDATE sales_transactions
              SET batch_id = $1, 
                  coin_cost = $2,
                  grading_cost = $3,
                  profit = $4,
                  profit_share = $5,
                  payout = $6
              WHERE transaction_id = $7
            `, [batch.batch_id, totalCoinCost, totalGradingCost, profit, profitShare, payout, sale.transaction_id]);
            
            reassigned++;
          } else {
            notFound++;
          }
        }
        
        // Recalculate batch_coins sold counts
        await query(`
          UPDATE batch_coins bc
          SET total_sold = COALESCE((
            SELECT SUM(st.quantity_sold)
            FROM sales_transactions st
            WHERE st.batch_id = bc.batch_id AND st.coin_type_id = bc.coin_type_id
              AND COALESCE(st.is_refund, false) = false
          ), 0)
        `);
        
        return res.json({ 
          success: true, 
          reassigned,
          notFound,
          message: `Reassigned ${reassigned} sales to batches. ${notFound} could not be matched.`
        });
      } catch (error) {
        console.error('Reassign error:', error);
        return res.status(500).json({ error: 'Failed to reassign: ' + error.message });
      }
    }
    return res.status(400).json({ error: 'Invalid action' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Ensure database has refund columns
    await ensureRefundColumns();
    
    const { transactions, titleMappings } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Transactions array required' });
    }

    // Step 1: Create new coin types first
    const createdCoinTypes = {};
    let createdCount = 0;
    
    if (titleMappings) {
      for (const [title, mapping] of Object.entries(titleMappings)) {
        if (mapping.action === 'create' && mapping.newName) {
          const originalPrice = parseFloat(mapping.cost) || 0;
          try {
            // Check if already exists
            const existing = await query(
              'SELECT * FROM coin_types WHERE LOWER(name) = LOWER($1)',
              [mapping.newName]
            );
            
            if (existing.rows.length > 0) {
              createdCoinTypes[title] = existing.rows[0];
            } else {
              const result = await query(
                `INSERT INTO coin_types (name, short_code, original_price, keywords)
                 VALUES ($1, $2, $3, $4)
                 RETURNING *`,
                [
                  mapping.newName,
                  mapping.newName.substring(0, 15).toUpperCase().replace(/\s+/g, ''),
                  originalPrice,
                  [mapping.newName.toLowerCase(), title.toLowerCase().substring(0, 100)]
                ]
              );
              createdCoinTypes[title] = result.rows[0];
              createdCount++;
            }
          } catch (err) {
            console.error(`Error creating coin type for "${title}":`, err);
          }
        }
      }
    }

    // Step 2: Get all coin types for lookup
    const coinTypesResult = await query('SELECT * FROM coin_types');
    const coinTypes = coinTypesResult.rows;

    // Build title -> coinType lookup
    const titleToCoinType = {};
    if (titleMappings) {
      for (const [title, mapping] of Object.entries(titleMappings)) {
        if (mapping.action === 'map' && mapping.coinTypeId) {
          const ct = coinTypes.find(c => c.coin_type_id === mapping.coinTypeId);
          if (ct) titleToCoinType[title] = ct;
        } else if (mapping.action === 'create' && createdCoinTypes[title]) {
          titleToCoinType[title] = createdCoinTypes[title];
        }
        // skip action = no entry in lookup
      }
    }

    // Step 3: Process transactions
    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const tx of transactions) {
      try {
        // Handle refund transactions (negative payout, offset previous sales)
        if (tx.isRefund || tx.type === 'refund') {
          // Check if this refund already exists
          if (tx.orderNumber) {
            const existing = await query(
              'SELECT transaction_id FROM sales_transactions WHERE order_number = $1 AND is_refund = true',
              [tx.orderNumber]
            );
            if (existing.rows.length > 0) {
              skipped++;
              continue;
            }
          }
          
          // Try to find the original order to get its coin_type_id
          let coinTypeId = null;
          if (tx.orderNumber) {
            const originalOrder = await query(
              'SELECT coin_type_id FROM sales_transactions WHERE order_number = $1 AND (is_refund IS NULL OR is_refund = false) LIMIT 1',
              [tx.orderNumber]
            );
            if (originalOrder.rows.length > 0) {
              coinTypeId = originalOrder.rows[0].coin_type_id;
            }
          }
          
          // Insert refund as negative transaction
          await query(`
            INSERT INTO sales_transactions (
              order_number, item_title, sale_date, sale_price, total_payout,
              profit, payout, coin_type_id, is_refund, imported_from
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, 'ebay_upload')
          `, [
            tx.orderNumber || null,
            tx.itemTitle || 'Refund',
            tx.saleDate || new Date().toISOString().split('T')[0],
            0,
            tx.totalPayout || 0, // Already negative
            tx.totalPayout || 0, // Negative profit
            tx.totalPayout || 0, // Negative payout
            coinTypeId
          ]);
          imported++;
          continue;
        }

        // Skip if no sale price (but allow refunds above)
        if (!tx.salePrice || tx.salePrice <= 0) continue;

        // Check for duplicate by order number
        if (tx.orderNumber) {
          const existing = await query(
            'SELECT transaction_id FROM sales_transactions WHERE order_number = $1 AND (is_refund IS NULL OR is_refund = false)',
            [tx.orderNumber]
          );
          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }
        }

        // Find coin type by exact title match
        const coinType = titleToCoinType[tx.itemTitle];
        const coinTypeId = coinType?.coin_type_id || null;
        
        // Get cost_per_coin and grading_cost_per_coin from batch_coins (use oldest batch with available inventory - FIFO)
        let coinCost = 0;
        let gradingCost = 0;
        let batchId = null;
        if (coinTypeId) {
          const batchCoin = await query(`
            SELECT bc.batch_id, bc.cost_per_coin, bc.grading_cost_per_coin, bc.total_contributed, bc.total_sold
            FROM batch_coins bc
            JOIN batches b ON bc.batch_id = b.batch_id
            WHERE bc.coin_type_id = $1 
              AND bc.cost_per_coin IS NOT NULL
              AND bc.total_sold < bc.total_contributed
            ORDER BY b.ship_date ASC NULLS LAST, b.created_at ASC
            LIMIT 1
          `, [coinTypeId]);
          
          if (batchCoin.rows.length > 0) {
            coinCost = parseFloat(batchCoin.rows[0].cost_per_coin) || 0;
            gradingCost = parseFloat(batchCoin.rows[0].grading_cost_per_coin) || 0;
            batchId = batchCoin.rows[0].batch_id;
          }
        }

        // Calculate values - shipping is now subtracted from payout
        const salePrice = parseFloat(tx.salePrice) || 0;
        const ebayFee = Math.abs(parseFloat(tx.ebayFee) || 0);
        const advertisingFee = Math.abs(parseFloat(tx.advertisingFee) || 0);
        const shippingCost = Math.abs(parseFloat(tx.shippingCost) || 0);
        const quantity = parseInt(tx.quantity) || 1;
        
        // totalPayout from frontend already has shipping subtracted
        const totalPayout = parseFloat(tx.totalPayout) || (salePrice - ebayFee - advertisingFee - shippingCost);
        const totalCoinCost = coinCost * quantity;
        const totalGradingCost = gradingCost * quantity;
        
        // Profit = eBay Payout - Coin Cost - Grading Cost
        const profit = totalPayout - totalCoinCost - totalGradingCost;
        const profitShare = Math.max(0.33 * profit, 8 * quantity);
        const payout = totalPayout - totalGradingCost - profitShare;
        const profitMargin = salePrice > 0 ? (profit / salePrice) : 0;

        // Mark if this order was refunded
        const isRefunded = tx.isRefunded || false;

        // Insert transaction
        await query(`
          INSERT INTO sales_transactions (
            batch_id, coin_type_id, listing_id, order_number, item_title, sale_date,
            sale_price, ebay_fee, advertising_fee, shipping_cost, total_payout,
            coin_cost, grading_cost, profit, profit_share, payout, profit_margin,
            grade, quantity_sold, imported_from, is_refunded
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        `, [
          batchId,
          coinTypeId,
          tx.listingId || null,
          tx.orderNumber || null,
          tx.itemTitle || null,
          tx.saleDate || new Date().toISOString().split('T')[0],
          salePrice,
          ebayFee,
          advertisingFee,
          shippingCost,
          totalPayout,
          totalCoinCost,
          totalGradingCost,
          profit,
          profitShare,
          payout,
          profitMargin,
          tx.grade || null,
          quantity,
          'ebay_upload',
          isRefunded
        ]);

        // Update batch_coins sold count
        if (batchId) {
          await query(`
            UPDATE batch_coins 
            SET total_sold = total_sold + $1, updated_at = CURRENT_TIMESTAMP
            WHERE batch_id = $2 AND coin_type_id = $3
          `, [quantity, batchId, coinTypeId]);
        }

        imported++;
      } catch (err) {
        errors.push(`Row ${tx.orderNumber || 'unknown'}: ${err.message}`);
      }
    }

    // Update batch_coins sold counts
    await query(`
      UPDATE batch_coins bc
      SET total_sold = (
        SELECT COALESCE(SUM(st.quantity_sold), 0)
        FROM sales_transactions st
        WHERE st.coin_type_id = bc.coin_type_id
      )
    `);

    return res.json({
      imported,
      skipped,
      createdCoinTypes: createdCount,
      errors: errors.slice(0, 10)
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
