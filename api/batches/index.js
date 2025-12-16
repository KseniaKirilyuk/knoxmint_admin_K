import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

// Ensure cost_per_coin column exists and migrate old prices (idempotent)
async function ensureCostColumn() {
  try {
    await query(`ALTER TABLE batch_coins ADD COLUMN IF NOT EXISTS cost_per_coin DECIMAL(10, 2)`);
    // Migrate old prices if they exist (and are positive)
    await query(`UPDATE batch_coins SET cost_per_coin = original_price WHERE cost_per_coin IS NULL AND original_price IS NOT NULL AND original_price > 0`);
    // Fix any 0 values to null (0 = not set)
    await query(`UPDATE batch_coins SET cost_per_coin = NULL WHERE cost_per_coin = 0`);
  } catch (e) {
    // Ignore - column may already exist or original_price may not exist
  }
}

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  try {
    // GET requests
    if (req.method === 'GET') {
      const { action, batchId } = req.query;

      // Get coin types
      if (action === 'coinTypes') {
        const result = await query('SELECT * FROM coin_types ORDER BY name');
        return res.json(result.rows);
      }

      // Get batch details with coins and contributions
      if (action === 'details' && batchId) {
        await ensureCostColumn();
        
        const batchResult = await query('SELECT * FROM batches WHERE batch_id = $1', [batchId]);
        if (batchResult.rows.length === 0) {
          return res.status(404).json({ error: 'Batch not found' });
        }

        const coinsResult = await query(`
          SELECT bc.*, ct.name as coin_type_name, ct.short_code, ct.mint_catalog_number
          FROM batch_coins bc
          JOIN coin_types ct ON bc.coin_type_id = ct.coin_type_id
          WHERE bc.batch_id = $1
          ORDER BY ct.name
        `, [batchId]);

        const contribResult = await query(`
          SELECT uc.*, u.username, u.full_name, ct.name as coin_type_name
          FROM user_contributions uc
          JOIN users u ON uc.user_id = u.user_id
          JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
          WHERE uc.batch_id = $1
          ORDER BY ct.name, u.full_name
        `, [batchId]);

        return res.json({
          batch: batchResult.rows[0],
          coins: coinsResult.rows,
          contributions: contribResult.rows
        });
      }

      // Get all batches with summary
      const result = await query(`
        SELECT 
          b.*,
          COALESCE(SUM(bc.total_contributed), 0) as total_coins,
          COUNT(DISTINCT uc.user_id) as contributor_count,
          COALESCE(SUM(bc.total_sold), 0) as total_sold
        FROM batches b
        LEFT JOIN batch_coins bc ON b.batch_id = bc.batch_id
        LEFT JOIN user_contributions uc ON b.batch_id = uc.batch_id
        GROUP BY b.batch_id
        ORDER BY b.ship_date DESC NULLS LAST, b.created_at DESC
      `);
      return res.json(result.rows);
    }

    // POST requests
    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { action } = req.body;

      // Create new batch
      if (action === 'create') {
        const { batchName, shipDate, grader, notes } = req.body;
        if (!batchName) return res.status(400).json({ error: 'Batch name required' });

        const result = await query(
          `INSERT INTO batches (batch_name, ship_date, grader, notes)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [batchName, shipDate || null, grader, notes]
        );
        return res.status(201).json(result.rows[0]);
      }

      // Upload contributions for a batch
      if (action === 'uploadContributions') {
        const { batchId, contributions, coinPrices, coinMappings } = req.body;
        if (!batchId || !contributions) {
          return res.status(400).json({ error: 'Batch ID and contributions required' });
        }

        let imported = 0;
        let errors = [];
        const coinTypeTotals = {};

        for (const contrib of contributions) {
          try {
            const { memberName, coinType, quantity } = contrib;
            if (!memberName || !coinType || quantity <= 0) continue;

            // Find or create user
            let userResult = await query(
              'SELECT user_id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(full_name) = LOWER($1)',
              [memberName]
            );
            
            let userId;
            if (userResult.rows.length === 0) {
              const newUser = await query(
                'INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING user_id',
                [memberName.toLowerCase().replace(/\s+/g, '_'), memberName, 'user']
              );
              userId = newUser.rows[0].user_id;
            } else {
              userId = userResult.rows[0].user_id;
            }

            // Check if this coin was manually mapped to an existing type
            let coinTypeId;
            if (coinMappings && coinMappings[coinType]) {
              coinTypeId = coinMappings[coinType];
            } else {
              // Find or create coin type
              let coinTypeResult = await query(
                'SELECT coin_type_id FROM coin_types WHERE LOWER(name) = LOWER($1)',
                [coinType]
              );
              
              if (coinTypeResult.rows.length === 0) {
                const newCoinType = await query(
                  'INSERT INTO coin_types (name, short_code, keywords) VALUES ($1, $2, $3) RETURNING coin_type_id',
                  [coinType, coinType.substring(0, 10).toUpperCase(), [coinType]]
                );
                coinTypeId = newCoinType.rows[0].coin_type_id;
              } else {
                coinTypeId = coinTypeResult.rows[0].coin_type_id;
              }
            }

            // Track totals per coin type
            if (!coinTypeTotals[coinTypeId]) {
              coinTypeTotals[coinTypeId] = 0;
            }
            coinTypeTotals[coinTypeId] += quantity;

            // Upsert contribution
            await query(`
              INSERT INTO user_contributions (user_id, batch_id, coin_type_id, quantity)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (user_id, batch_id, coin_type_id)
              DO UPDATE SET quantity = user_contributions.quantity + $4, updated_at = CURRENT_TIMESTAMP
            `, [userId, batchId, coinTypeId, quantity]);

            imported++;
          } catch (err) {
            errors.push(`${contrib.memberName}: ${err.message}`);
          }
        }

        // Update batch_coins totals and cost
        for (const [coinTypeId, total] of Object.entries(coinTypeTotals)) {
          const costPerCoin = coinPrices?.[coinTypeId] || null;
          await query(`
            INSERT INTO batch_coins (batch_id, coin_type_id, total_contributed, cost_per_coin)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (batch_id, coin_type_id)
            DO UPDATE SET 
              total_contributed = batch_coins.total_contributed + $3,
              cost_per_coin = COALESCE($4, batch_coins.cost_per_coin),
              updated_at = CURRENT_TIMESTAMP
          `, [batchId, coinTypeId, total, costPerCoin]);
        }

        return res.json({ success: true, imported, errors: errors.slice(0, 10) });
      }

      // Add single contribution
      if (action === 'addContribution') {
        const { batchId, userId, coinTypeId, quantity } = req.body;
        if (!batchId || !userId || !coinTypeId) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        await query(`
          INSERT INTO user_contributions (user_id, batch_id, coin_type_id, quantity)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id, batch_id, coin_type_id)
          DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
        `, [userId, batchId, coinTypeId, quantity]);

        // Update batch_coins total
        await query(`
          INSERT INTO batch_coins (batch_id, coin_type_id, total_contributed)
          VALUES ($1, $2, $3)
          ON CONFLICT (batch_id, coin_type_id)
          DO UPDATE SET total_contributed = (
            SELECT COALESCE(SUM(quantity), 0) FROM user_contributions 
            WHERE batch_id = $1 AND coin_type_id = $2
          )
        `, [batchId, coinTypeId, quantity]);

        return res.json({ success: true });
      }

      // Add or update coin type
      if (action === 'addCoinType') {
        const { name, shortCode, mintCatalogNumber, description } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });

        const result = await query(
          `INSERT INTO coin_types (name, short_code, mint_catalog_number, description, keywords)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (name) DO UPDATE SET
             short_code = COALESCE(EXCLUDED.short_code, coin_types.short_code),
             mint_catalog_number = COALESCE(EXCLUDED.mint_catalog_number, coin_types.mint_catalog_number),
             description = COALESCE(EXCLUDED.description, coin_types.description)
           RETURNING *`,
          [name, shortCode || null, mintCatalogNumber || null, description || null, [name]]
        );
        return res.status(201).json(result.rows[0]);
      }

      // Update coin type
      if (action === 'updateCoinType') {
        const { coinTypeId, name, shortCode, mintCatalogNumber, description } = req.body;
        if (!coinTypeId) return res.status(400).json({ error: 'Coin type ID required' });

        const result = await query(
          `UPDATE coin_types SET
            name = COALESCE($1, name),
            short_code = $2,
            mint_catalog_number = $3,
            description = $4
           WHERE coin_type_id = $5
           RETURNING *`,
          [name, shortCode || null, mintCatalogNumber || null, description || null, coinTypeId]
        );
        
        if (result.rows.length === 0) {
          return res.status(404).json({ error: 'Coin type not found' });
        }
        return res.json(result.rows[0]);
      }

      // Delete coin type
      if (action === 'deleteCoinType') {
        const { coinTypeId } = req.body;
        if (!coinTypeId) return res.status(400).json({ error: 'Coin type ID required' });

        // Check if coin type is used in transactions
        const usageCheck = await query(
          'SELECT COUNT(*) as count FROM sales_transactions WHERE coin_type_id = $1',
          [coinTypeId]
        );
        
        if (parseInt(usageCheck.rows[0].count) > 0) {
          return res.status(400).json({ 
            error: `Cannot delete: This coin type is used in ${usageCheck.rows[0].count} sales transactions` 
          });
        }

        // Check if coin type is used in contributions
        const contribCheck = await query(
          'SELECT COUNT(*) as count FROM user_contributions WHERE coin_type_id = $1',
          [coinTypeId]
        );
        
        if (parseInt(contribCheck.rows[0].count) > 0) {
          return res.status(400).json({ 
            error: `Cannot delete: This coin type is used in ${contribCheck.rows[0].count} user contributions` 
          });
        }

        await query('DELETE FROM batch_coins WHERE coin_type_id = $1', [coinTypeId]);
        await query('DELETE FROM coin_types WHERE coin_type_id = $1', [coinTypeId]);
        
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Invalid action' });
    }

    // PUT requests
    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { batchId } = req.query;
      const { batchName, shipDate, grader, status, notes, coinPrices } = req.body;

      // Update batch
      if (batchId && !coinPrices) {
        await query(
          `UPDATE batches SET 
            batch_name = COALESCE($1, batch_name),
            ship_date = COALESCE($2, ship_date),
            grader = COALESCE($3, grader),
            status = COALESCE($4, status),
            notes = COALESCE($5, notes),
            updated_at = CURRENT_TIMESTAMP
           WHERE batch_id = $6`,
          [batchName, shipDate, grader, status, notes, batchId]
        );
        return res.json({ success: true });
      }

      // Update coin prices in batch (simple cost_per_coin)
      if (batchId && coinPrices) {
        await ensureCostColumn();
        
        for (const [coinTypeId, price] of Object.entries(coinPrices)) {
          // Only save if we have a valid positive price, otherwise null
          let priceValue = null;
          if (price !== '' && price !== null && price !== undefined) {
            const parsed = parseFloat(price);
            // Only save positive values (0 = not set)
            if (!isNaN(parsed) && parsed > 0) {
              priceValue = parsed;
            }
          }
          await query(`
            UPDATE batch_coins 
            SET cost_per_coin = $1, updated_at = CURRENT_TIMESTAMP
            WHERE batch_id = $2 AND coin_type_id = $3
          `, [priceValue, batchId, coinTypeId]);
        }
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Batch ID required' });
    }

    // DELETE requests
    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { batchId, contributionId } = req.query;

      if (contributionId) {
        await query('DELETE FROM user_contributions WHERE id = $1', [contributionId]);
        return res.json({ success: true });
      }

      if (batchId) {
        await query('DELETE FROM batches WHERE batch_id = $1', [batchId]);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'ID required' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Batches error:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'Already exists' });
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
