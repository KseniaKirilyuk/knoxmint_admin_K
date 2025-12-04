const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all groups
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        g.*,
        COUNT(DISTINCT uc.user_id) as member_count,
        COUNT(DISTINCT st.transaction_id) as transaction_count,
        COALESCE(SUM(st.profit), 0) as total_profit
      FROM groups g
      LEFT JOIN user_contributions uc ON g.group_id = uc.group_id
      LEFT JOIN sales_transactions st ON g.group_id = st.group_id
      GROUP BY g.group_id
      ORDER BY g.group_name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get group by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM groups WHERE group_id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching group:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new group
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { 
      groupName, 
      grader, 
      labelType, 
      profitSharePercentage, 
      profitShareMinimum,
      profitShareMaximum,
      description 
    } = req.body;

    if (!groupName) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const result = await db.query(`
      INSERT INTO groups (group_name, grader, label_type, profit_share_percentage, profit_share_minimum, profit_share_maximum, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      groupName, 
      grader, 
      labelType, 
      profitSharePercentage || 0.33, 
      profitShareMinimum || 8.00,
      profitShareMaximum,
      description
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Group name already exists' });
    }
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update group
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { 
      groupName, 
      grader, 
      labelType, 
      status,
      profitSharePercentage, 
      profitShareMinimum,
      profitShareMaximum,
      description 
    } = req.body;

    const result = await db.query(`
      UPDATE groups
      SET group_name = COALESCE($1, group_name),
          grader = COALESCE($2, grader),
          label_type = COALESCE($3, label_type),
          status = COALESCE($4, status),
          profit_share_percentage = COALESCE($5, profit_share_percentage),
          profit_share_minimum = COALESCE($6, profit_share_minimum),
          profit_share_maximum = $7,
          description = COALESCE($8, description)
      WHERE group_id = $9
      RETURNING *
    `, [
      groupName, grader, labelType, status, 
      profitSharePercentage, profitShareMinimum, profitShareMaximum, 
      description, req.params.id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get group members
router.get('/:id/members', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        u.user_id,
        u.username,
        u.full_name,
        SUM(uc.quantity) as total_coins,
        COUNT(DISTINCT uc.graded_coin_id) as coin_types
      FROM user_contributions uc
      JOIN users u ON uc.user_id = u.user_id
      WHERE uc.group_id = $1
      GROUP BY u.user_id, u.username, u.full_name
      ORDER BY u.username
    `, [req.params.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching group members:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add user to group
router.post('/:id/members', authenticate, requireAdmin, async (req, res) => {
  try {
    const { userId, gradedCoinId, quantity } = req.body;

    const result = await db.query(`
      INSERT INTO user_contributions (user_id, group_id, graded_coin_id, quantity)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, group_id, graded_coin_id) 
      DO UPDATE SET quantity = user_contributions.quantity + EXCLUDED.quantity
      RETURNING *
    `, [userId, req.params.id, gradedCoinId, quantity]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error adding member:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove user from group (only if no pending payouts)
router.delete('/:groupId/members/:userId', authenticate, requireAdmin, async (req, res) => {
  try {
    const { groupId, userId } = req.params;

    // Check for pending payouts
    const pendingCheck = await db.query(`
      SELECT COUNT(*) as pending_count
      FROM payouts
      WHERE user_id = $1 AND group_id = $2 AND status = 'Pending'
    `, [userId, groupId]);

    if (parseInt(pendingCheck.rows[0].pending_count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot remove user with pending payouts. Close payouts first.' 
      });
    }

    await db.query(`
      DELETE FROM user_contributions
      WHERE user_id = $1 AND group_id = $2
    `, [userId, groupId]);

    res.json({ message: 'User removed from group' });
  } catch (error) {
    console.error('Error removing member:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get group transactions
router.get('/:id/transactions', authenticate, async (req, res) => {
  try {
    const { startDate, endDate, limit = 100, offset = 0 } = req.query;
    
    let query = `
      SELECT 
        st.*,
        gc.grade,
        gc.label_type,
        mp.design,
        mp.mint_catalog_number
      FROM sales_transactions st
      LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
      LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
      WHERE st.group_id = $1
    `;
    const params = [req.params.id];
    let paramIndex = 2;

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

    query += ` ORDER BY st.sale_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
