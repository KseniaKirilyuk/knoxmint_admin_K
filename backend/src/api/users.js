const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all users
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT user_id, username, email, full_name, payment_info, role, is_active, created_at
      FROM users
      ORDER BY username
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user by ID
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT user_id, username, email, full_name, payment_info, role, is_active, created_at
      FROM users
      WHERE user_id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create new user
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, email, password, fullName, paymentInfo, role } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    const result = await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, payment_info, role)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING user_id, username, email, full_name, role, is_active, created_at
    `, [username, email, passwordHash, fullName, paymentInfo, role || 'user']);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Username or email already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { username, email, fullName, paymentInfo, role, isActive } = req.body;

    const result = await db.query(`
      UPDATE users
      SET username = COALESCE($1, username),
          email = COALESCE($2, email),
          full_name = COALESCE($3, full_name),
          payment_info = COALESCE($4, payment_info),
          role = COALESCE($5, role),
          is_active = COALESCE($6, is_active)
      WHERE user_id = $7
      RETURNING user_id, username, email, full_name, role, is_active
    `, [username, email, fullName, paymentInfo, role, isActive, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's contributions (groups they're in)
router.get('/:id/contributions', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        uc.id,
        g.group_id,
        g.group_name,
        gc.graded_coin_id,
        mp.design,
        mp.mint_catalog_number,
        gc.grade,
        gc.label_type,
        uc.quantity
      FROM user_contributions uc
      JOIN groups g ON uc.group_id = g.group_id
      JOIN graded_coins gc ON uc.graded_coin_id = gc.graded_coin_id
      JOIN mint_products mp ON gc.product_id = mp.product_id
      WHERE uc.user_id = $1
      ORDER BY g.group_name, mp.design
    `, [req.params.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching contributions:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get user's payout history
router.get('/:id/payouts', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        p.payout_id,
        p.payout_date,
        p.amount,
        p.status,
        p.payment_method,
        p.payment_reference,
        g.group_name
      FROM payouts p
      JOIN groups g ON p.group_id = g.group_id
      WHERE p.user_id = $1
      ORDER BY p.payout_date DESC
    `, [req.params.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
