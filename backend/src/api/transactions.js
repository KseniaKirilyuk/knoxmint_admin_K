const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all transactions with filters
router.get('/', authenticate, async (req, res) => {
  try {
    const { groupId, startDate, endDate, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        st.*,
        g.group_name,
        gc.grade,
        gc.label_type as coin_label,
        mp.design,
        mp.mint_catalog_number
      FROM sales_transactions st
      JOIN groups g ON st.group_id = g.group_id
      LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
      LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (groupId) {
      query += ` AND st.group_id = $${paramIndex}`;
      params.push(groupId);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND st.sale_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND st.sale_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    query += ` ORDER BY st.sale_date DESC, st.transaction_id DESC`;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM sales_transactions st
      WHERE 1=1
    `;
    const countParams = [];
    let countParamIndex = 1;

    if (groupId) {
      countQuery += ` AND st.group_id = $${countParamIndex}`;
      countParams.push(groupId);
      countParamIndex++;
    }
    if (startDate) {
      countQuery += ` AND st.sale_date >= $${countParamIndex}`;
      countParams.push(startDate);
      countParamIndex++;
    }
    if (endDate) {
      countQuery += ` AND st.sale_date <= $${countParamIndex}`;
      countParams.push(endDate);
    }

    const countResult = await db.query(countQuery, countParams);

    res.json({
      transactions: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get transaction by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        st.*,
        g.group_name,
        gc.grade,
        gc.label_type as coin_label,
        mp.design,
        mp.mint_catalog_number
      FROM sales_transactions st
      JOIN groups g ON st.group_id = g.group_id
      LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
      LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
      WHERE st.transaction_id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create transaction
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      groupId,
      gradedCoinId,
      listingId,
      saleDate,
      salePrice,
      ebayFee,
      advertisingFee,
      shippingCost,
      coinCost,
      saleType,
      quantitySold,
      buyerUsername,
      notes
    } = req.body;

    // Get group's profit share settings
    const groupResult = await db.query(
      'SELECT profit_share_percentage, profit_share_minimum, profit_share_maximum FROM groups WHERE group_id = $1',
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      return res.status(400).json({ error: 'Group not found' });
    }

    const group = groupResult.rows[0];

    // Calculate totals
    const totalPayout = parseFloat(salePrice) - (parseFloat(ebayFee) || 0) - (parseFloat(advertisingFee) || 0) - (parseFloat(shippingCost) || 0);
    const profit = totalPayout - parseFloat(coinCost);
    
    // Calculate profit share using group settings
    let profitShare = profit * parseFloat(group.profit_share_percentage);
    profitShare = Math.max(profitShare, parseFloat(group.profit_share_minimum));
    if (group.profit_share_maximum) {
      profitShare = Math.min(profitShare, parseFloat(group.profit_share_maximum));
    }

    const result = await db.query(`
      INSERT INTO sales_transactions (
        group_id, graded_coin_id, listing_id, sale_date, sale_price,
        ebay_fee, advertising_fee, shipping_cost, total_payout,
        coin_cost, profit, profit_share, sale_type, quantity_sold,
        buyer_username, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      groupId, gradedCoinId, listingId, saleDate, salePrice,
      ebayFee || 0, advertisingFee || 0, shippingCost || 0, totalPayout,
      coinCost, profit, profitShare, saleType, quantitySold || 1,
      buyerUsername, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update transaction
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const {
      saleDate,
      salePrice,
      ebayFee,
      advertisingFee,
      shippingCost,
      coinCost,
      saleType,
      quantitySold,
      buyerUsername,
      notes
    } = req.body;

    // Recalculate if prices changed
    const totalPayout = parseFloat(salePrice) - (parseFloat(ebayFee) || 0) - (parseFloat(advertisingFee) || 0) - (parseFloat(shippingCost) || 0);
    const profit = totalPayout - parseFloat(coinCost);

    // Get group settings for profit share recalculation
    const txResult = await db.query('SELECT group_id FROM sales_transactions WHERE transaction_id = $1', [req.params.id]);
    if (txResult.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const groupResult = await db.query(
      'SELECT profit_share_percentage, profit_share_minimum, profit_share_maximum FROM groups WHERE group_id = $1',
      [txResult.rows[0].group_id]
    );
    const group = groupResult.rows[0];

    let profitShare = profit * parseFloat(group.profit_share_percentage);
    profitShare = Math.max(profitShare, parseFloat(group.profit_share_minimum));
    if (group.profit_share_maximum) {
      profitShare = Math.min(profitShare, parseFloat(group.profit_share_maximum));
    }

    const result = await db.query(`
      UPDATE sales_transactions
      SET sale_date = COALESCE($1, sale_date),
          sale_price = COALESCE($2, sale_price),
          ebay_fee = COALESCE($3, ebay_fee),
          advertising_fee = COALESCE($4, advertising_fee),
          shipping_cost = COALESCE($5, shipping_cost),
          total_payout = $6,
          coin_cost = COALESCE($7, coin_cost),
          profit = $8,
          profit_share = $9,
          sale_type = COALESCE($10, sale_type),
          quantity_sold = COALESCE($11, quantity_sold),
          buyer_username = COALESCE($12, buyer_username),
          notes = COALESCE($13, notes)
      WHERE transaction_id = $14
      RETURNING *
    `, [
      saleDate, salePrice, ebayFee, advertisingFee, shippingCost,
      totalPayout, coinCost, profit, profitShare, saleType,
      quantitySold, buyerUsername, notes, req.params.id
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete transaction
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    // Check if transaction is part of any payout
    const payoutCheck = await db.query(
      'SELECT COUNT(*) FROM payout_items WHERE transaction_id = $1',
      [req.params.id]
    );

    if (parseInt(payoutCheck.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete transaction that is part of a payout' 
      });
    }

    await db.query('DELETE FROM sales_transactions WHERE transaction_id = $1', [req.params.id]);
    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
