const express = require('express');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all mint products
router.get('/products', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM mint_products ORDER BY year DESC, design
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create mint product
router.post('/products', authenticate, requireAdmin, async (req, res) => {
  try {
    const { year, design, finish, mintCatalogNumber, metalType, weightOz, description } = req.body;

    const result = await db.query(`
      INSERT INTO mint_products (year, design, finish, mint_catalog_number, metal_type, weight_oz, description)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [year, design, finish, mintCatalogNumber, metalType || 'Silver', weightOz || 1.0, description]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all graded coins
router.get('/graded', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        gc.*,
        mp.year,
        mp.design,
        mp.finish,
        mp.mint_catalog_number,
        mp.metal_type,
        gb.submission_date,
        gb.return_date
      FROM graded_coins gc
      JOIN mint_products mp ON gc.product_id = mp.product_id
      LEFT JOIN grading_batches gb ON gc.batch_id = gb.batch_id
      ORDER BY gc.graded_coin_id
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching graded coins:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get graded coin by ID
router.get('/graded/:id', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        gc.*,
        mp.year,
        mp.design,
        mp.finish,
        mp.mint_catalog_number,
        mp.metal_type
      FROM graded_coins gc
      JOIN mint_products mp ON gc.product_id = mp.product_id
      WHERE gc.graded_coin_id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Graded coin not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching graded coin:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create graded coin
router.post('/graded', authenticate, requireAdmin, async (req, res) => {
  try {
    const { 
      productId, 
      batchId, 
      grader, 
      grade, 
      labelType, 
      quantity, 
      rawCostPerCoin, 
      gradingCostPerCoin 
    } = req.body;

    const totalCost = (parseFloat(rawCostPerCoin) || 0) + (parseFloat(gradingCostPerCoin) || 0);

    const result = await db.query(`
      INSERT INTO graded_coins (product_id, batch_id, grader, grade, label_type, quantity, raw_cost_per_coin, grading_cost_per_coin, total_cost_per_coin)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [productId, batchId, grader, grade, labelType, quantity, rawCostPerCoin, gradingCostPerCoin, totalCost]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating graded coin:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update graded coin
router.put('/graded/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { grade, labelType, quantity, rawCostPerCoin, gradingCostPerCoin } = req.body;

    const totalCost = (parseFloat(rawCostPerCoin) || 0) + (parseFloat(gradingCostPerCoin) || 0);

    const result = await db.query(`
      UPDATE graded_coins
      SET grade = COALESCE($1, grade),
          label_type = COALESCE($2, label_type),
          quantity = COALESCE($3, quantity),
          raw_cost_per_coin = COALESCE($4, raw_cost_per_coin),
          grading_cost_per_coin = COALESCE($5, grading_cost_per_coin),
          total_cost_per_coin = $6
      WHERE graded_coin_id = $7
      RETURNING *
    `, [grade, labelType, quantity, rawCostPerCoin, gradingCostPerCoin, totalCost, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Graded coin not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating graded coin:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all grading batches
router.get('/batches', authenticate, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        gb.*,
        COUNT(gc.graded_coin_id) as coin_count,
        SUM(gc.quantity) as total_coins
      FROM grading_batches gb
      LEFT JOIN graded_coins gc ON gb.batch_id = gc.batch_id
      GROUP BY gb.batch_id
      ORDER BY gb.submission_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching batches:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create grading batch
router.post('/batches', authenticate, requireAdmin, async (req, res) => {
  try {
    const { grader, submissionDate, returnDate, totalGradingCost, coinsSubmitted, notes } = req.body;

    const result = await db.query(`
      INSERT INTO grading_batches (grader, submission_date, return_date, total_grading_cost, coins_submitted, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [grader, submissionDate, returnDate, totalGradingCost, coinsSubmitted, notes]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating batch:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
