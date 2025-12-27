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

// Ensure catalog_id and is_ungraded columns exist
async function ensureCoinTypeColumns() {
  try {
    await query(`ALTER TABLE coin_types ADD COLUMN IF NOT EXISTS catalog_id VARCHAR(50)`);
    await query(`ALTER TABLE coin_types ADD COLUMN IF NOT EXISTS is_ungraded BOOLEAN DEFAULT false`);
    // Increase short_code size to accommodate "-UNGRADED" suffix
    await query(`ALTER TABLE coin_types ALTER COLUMN short_code TYPE VARCHAR(50)`);
    // Migrate existing coins - set catalog_id from short_code if not set
    await query(`UPDATE coin_types SET catalog_id = short_code WHERE catalog_id IS NULL AND short_code IS NOT NULL`);
  } catch (e) {
    // Ignore - columns may already exist
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
        await ensureCoinTypeColumns();
        const result = await query('SELECT * FROM coin_types ORDER BY catalog_id, is_ungraded, name');
        return res.json(result.rows);
      }

      // Get batch details with coins and contributions
      if (action === 'details' && batchId) {
        await ensureCostColumn();
        await ensureCoinTypeColumns();
        
        const batchResult = await query('SELECT * FROM batches WHERE batch_id = $1', [batchId]);
        if (batchResult.rows.length === 0) {
          return res.status(404).json({ error: 'Batch not found' });
        }

        const coinsResult = await query(`
          SELECT bc.*, ct.name as coin_type_name, ct.short_code, ct.catalog_id, ct.is_ungraded
          FROM batch_coins bc
          JOIN coin_types ct ON bc.coin_type_id = ct.coin_type_id
          WHERE bc.batch_id = $1
          ORDER BY ct.catalog_id, ct.is_ungraded, ct.name
        `, [batchId]);

        const contribResult = await query(`
          SELECT uc.*, u.username, u.full_name, ct.name as coin_type_name, ct.catalog_id, ct.is_ungraded
          FROM user_contributions uc
          JOIN users u ON uc.user_id = u.user_id
          JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
          WHERE uc.batch_id = $1
          ORDER BY ct.catalog_id, ct.is_ungraded, u.full_name
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
          COALESCE(coins.total_coins, 0) as total_coins,
          COALESCE(coins.total_sold, 0) as total_sold,
          COALESCE(contribs.contributor_count, 0) as contributor_count
        FROM batches b
        LEFT JOIN (
          SELECT batch_id, SUM(total_contributed) as total_coins, SUM(total_sold) as total_sold
          FROM batch_coins
          GROUP BY batch_id
        ) coins ON b.batch_id = coins.batch_id
        LEFT JOIN (
          SELECT batch_id, COUNT(DISTINCT user_id) as contributor_count
          FROM user_contributions
          GROUP BY batch_id
        ) contribs ON b.batch_id = contribs.batch_id
        ORDER BY b.ship_date DESC NULLS LAST, b.created_at DESC
      `);
      return res.json(result.rows);
    }

    // POST requests
    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const action = req.query.action || req.body.action;

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

      // Add single contribution
      if (action === 'addContribution') {
        const { batchId, userId, coinTypeId, quantity } = req.body;
        if (!batchId || !userId || !coinTypeId || !quantity) {
          return res.status(400).json({ error: 'Batch ID, user ID, coin type ID, and quantity required' });
        }

        // Check if user already has contribution for this coin type in this batch
        const existing = await query(
          'SELECT id, quantity FROM user_contributions WHERE batch_id = $1 AND user_id = $2 AND coin_type_id = $3',
          [batchId, userId, coinTypeId]
        );

        if (existing.rows.length > 0) {
          // Update existing
          await query(
            'UPDATE user_contributions SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
            [quantity, existing.rows[0].id]
          );
        } else {
          // Insert new
          await query(
            'INSERT INTO user_contributions (user_id, batch_id, coin_type_id, quantity) VALUES ($1, $2, $3, $4)',
            [userId, batchId, coinTypeId, quantity]
          );
        }

        // Update batch_coins
        const bcExists = await query(
          'SELECT 1 FROM batch_coins WHERE batch_id = $1 AND coin_type_id = $2',
          [batchId, coinTypeId]
        );
        
        if (bcExists.rows.length === 0) {
          await query(
            'INSERT INTO batch_coins (batch_id, coin_type_id, total_contributed) VALUES ($1, $2, $3)',
            [batchId, coinTypeId, quantity]
          );
        } else {
          await query(`
            UPDATE batch_coins 
            SET total_contributed = (
              SELECT COALESCE(SUM(quantity), 0) FROM user_contributions 
              WHERE batch_id = $1 AND coin_type_id = $2
            )
            WHERE batch_id = $1 AND coin_type_id = $2
          `, [batchId, coinTypeId]);
        }

        return res.json({ success: true });
      }

      // Split grading results - redistribute contributions into graded/ungraded
      if (action === 'splitGradingResults') {
        await ensureCoinTypeColumns();
        const { batchId, splits } = req.body;
        // splits = [{ coinTypeId: 1, catalogId: '23XH', graded: 80, ungraded: 20 }, ...]
        
        if (!batchId || !splits || !Array.isArray(splits)) {
          return res.status(400).json({ error: 'Batch ID and splits array required' });
        }

        // Use a transaction to ensure all-or-nothing
        try {
          await query('BEGIN');

          for (const split of splits) {
            const { coinTypeId, catalogId, graded, ungraded } = split;
            if (!coinTypeId || (graded === undefined && ungraded === undefined)) continue;

            const totalCoins = (graded || 0) + (ungraded || 0);
            if (totalCoins === 0) continue;

            // Use the coinTypeId directly as the base coin type
            const baseCoinTypeId = coinTypeId;

            // Get base coin info for creating ungraded variant
            const baseCoinInfo = await query(
              'SELECT name, short_code, catalog_id FROM coin_types WHERE coin_type_id = $1', 
              [baseCoinTypeId]
            );
            
            if (baseCoinInfo.rows.length === 0) continue;
            
            const baseName = baseCoinInfo.rows[0].name.replace(' (Ungraded)', '');
            const baseCode = baseCoinInfo.rows[0].short_code?.replace('-UNGRADED', '') || catalogId;
            const baseCatalogId = baseCoinInfo.rows[0].catalog_id || catalogId;

          // Find or create the ungraded variant
          let ungradedCoinTypeId;
          const ungradedCoin = await query(
            `SELECT coin_type_id FROM coin_types 
             WHERE (catalog_id = $1 OR short_code = $2) AND is_ungraded = true LIMIT 1`,
            [baseCatalogId, `${baseCode}-UNGRADED`]
          );
          
          if (ungradedCoin.rows.length === 0) {
            // Create ungraded variant
            const newUngraded = await query(
              `INSERT INTO coin_types (name, short_code, catalog_id, is_ungraded, keywords)
               VALUES ($1, $2, $3, true, $4)
               RETURNING coin_type_id`,
              [`${baseName} (Ungraded)`, `${baseCode}-UNGRADED`, baseCatalogId, [baseName, baseCatalogId]]
            );
            ungradedCoinTypeId = newUngraded.rows[0].coin_type_id;
          } else {
            ungradedCoinTypeId = ungradedCoin.rows[0].coin_type_id;
          }

          // Get all contributions for this batch and base coin type
          const contributions = await query(
            `SELECT id, user_id, quantity FROM user_contributions 
             WHERE batch_id = $1 AND coin_type_id = $2`,
            [batchId, baseCoinTypeId]
          );

          const gradedRatio = graded / totalCoins;

          // Split each contribution
          for (const contrib of contributions.rows) {
            const gradedQty = Math.round(contrib.quantity * gradedRatio);
            const ungradedQty = contrib.quantity - gradedQty; // Use remainder to ensure total stays same

            // Update graded contribution (keep in base coin type)
            if (gradedQty > 0) {
              await query(
                `UPDATE user_contributions SET quantity = $1 WHERE id = $2`,
                [gradedQty, contrib.id]
              );
            } else {
              await query('DELETE FROM user_contributions WHERE id = $1', [contrib.id]);
            }

            // Create ungraded contribution
            if (ungradedQty > 0) {
              await query(
                `INSERT INTO user_contributions (user_id, batch_id, coin_type_id, quantity)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (user_id, batch_id, coin_type_id)
                 DO UPDATE SET quantity = user_contributions.quantity + $4`,
                [contrib.user_id, batchId, ungradedCoinTypeId, ungradedQty]
              );
            }
          }

          // Update batch_coins totals for graded
          await query(`
            INSERT INTO batch_coins (batch_id, coin_type_id, total_contributed)
            SELECT $1, $2, COALESCE(SUM(quantity), 0) 
            FROM user_contributions WHERE batch_id = $1 AND coin_type_id = $2
            ON CONFLICT (batch_id, coin_type_id)
            DO UPDATE SET total_contributed = (
              SELECT COALESCE(SUM(quantity), 0) FROM user_contributions 
              WHERE batch_id = $1 AND coin_type_id = $2
            )
          `, [batchId, baseCoinTypeId]);

          // Update batch_coins totals for ungraded
          await query(`
            INSERT INTO batch_coins (batch_id, coin_type_id, total_contributed)
            SELECT $1, $2, COALESCE(SUM(quantity), 0) 
            FROM user_contributions WHERE batch_id = $1 AND coin_type_id = $2
            ON CONFLICT (batch_id, coin_type_id)
            DO UPDATE SET total_contributed = (
              SELECT COALESCE(SUM(quantity), 0) FROM user_contributions 
              WHERE batch_id = $1 AND coin_type_id = $2
            )
          `, [batchId, ungradedCoinTypeId]);
        }

          await query('COMMIT');
          return res.json({ success: true });
        } catch (splitError) {
          await query('ROLLBACK');
          console.error('Split grading error:', splitError);
          return res.status(500).json({ error: 'Server error: ' + splitError.message });
        }
      }

      // Bulk import multiple batches
      if (action === 'bulkImport') {
        const { batches, coinCodeMappings, newCoinTypes } = req.body;
        
        if (!batches || !Array.isArray(batches)) {
          return res.status(400).json({ error: 'Batches array required' });
        }

        let batchesCreated = 0;
        let contributionsCreated = 0;
        let coinTypesCreated = 0;
        const errors = [];
        const coinTypeCache = {}; // Cache for newly created coin types

        // First, create any new coin types
        for (const [code, mapping] of Object.entries(coinCodeMappings || {})) {
          if (mapping === 'new' && newCoinTypes?.[code]) {
            try {
              const { name, shortCode } = newCoinTypes[code];
              const existing = await query(
                'SELECT coin_type_id FROM coin_types WHERE LOWER(name) = LOWER($1) OR LOWER(short_code) = LOWER($2)',
                [name, shortCode || name]
              );
              
              if (existing.rows.length > 0) {
                coinTypeCache[code] = existing.rows[0].coin_type_id;
              } else {
                const result = await query(
                  'INSERT INTO coin_types (name, short_code) VALUES ($1, $2) RETURNING coin_type_id',
                  [name, shortCode || null]
                );
                coinTypeCache[code] = result.rows[0].coin_type_id;
                coinTypesCreated++;
              }
            } catch (err) {
              errors.push(`Failed to create coin type for ${code}: ${err.message}`);
            }
          }
        }

        // Now process each batch
        for (const batchData of batches) {
          try {
            const { batchName, contributions } = batchData;
            
            // Check if batch already exists
            const existingBatch = await query(
              'SELECT batch_id FROM batches WHERE LOWER(batch_name) = LOWER($1)',
              [batchName]
            );
            
            let batchId;
            if (existingBatch.rows.length > 0) {
              batchId = existingBatch.rows[0].batch_id;
            } else {
              const batchResult = await query(
                'INSERT INTO batches (batch_name) VALUES ($1) RETURNING batch_id',
                [batchName]
              );
              batchId = batchResult.rows[0].batch_id;
              batchesCreated++;
            }

            // Process contributions
            const coinTypeTotals = {};
            
            for (const contrib of contributions) {
              try {
                const { memberName, coinCode, coinTypeId, quantity } = contrib;
                if (!memberName || !quantity || quantity <= 0) continue;

                // Resolve coin type ID
                let resolvedCoinTypeId = coinTypeId;
                if (!resolvedCoinTypeId) {
                  // Check cache for newly created coin types
                  if (coinTypeCache[coinCode]) {
                    resolvedCoinTypeId = coinTypeCache[coinCode];
                  } else if (coinCodeMappings[coinCode] && coinCodeMappings[coinCode] !== 'new') {
                    resolvedCoinTypeId = parseInt(coinCodeMappings[coinCode]);
                  }
                }

                if (!resolvedCoinTypeId) {
                  errors.push(`No coin type mapping for ${coinCode}`);
                  continue;
                }

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

                // Check for existing contribution
                const existingContrib = await query(
                  'SELECT id FROM user_contributions WHERE batch_id = $1 AND user_id = $2 AND coin_type_id = $3',
                  [batchId, userId, resolvedCoinTypeId]
                );

                if (existingContrib.rows.length > 0) {
                  await query(
                    'UPDATE user_contributions SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                    [quantity, existingContrib.rows[0].id]
                  );
                } else {
                  await query(
                    'INSERT INTO user_contributions (user_id, batch_id, coin_type_id, quantity) VALUES ($1, $2, $3, $4)',
                    [userId, batchId, resolvedCoinTypeId, quantity]
                  );
                }
                
                contributionsCreated++;
                
                // Track totals for batch_coins
                if (!coinTypeTotals[resolvedCoinTypeId]) coinTypeTotals[resolvedCoinTypeId] = 0;
                coinTypeTotals[resolvedCoinTypeId] += quantity;
              } catch (err) {
                errors.push(`Error processing ${contrib.memberName}/${contrib.coinCode}: ${err.message}`);
              }
            }

            // Update batch_coins
            for (const [ctId, total] of Object.entries(coinTypeTotals)) {
              const bcExists = await query(
                'SELECT 1 FROM batch_coins WHERE batch_id = $1 AND coin_type_id = $2',
                [batchId, ctId]
              );
              
              if (bcExists.rows.length === 0) {
                await query(
                  'INSERT INTO batch_coins (batch_id, coin_type_id, total_contributed) VALUES ($1, $2, $3)',
                  [batchId, ctId, total]
                );
              } else {
                await query(`
                  UPDATE batch_coins 
                  SET total_contributed = (
                    SELECT COALESCE(SUM(quantity), 0) FROM user_contributions 
                    WHERE batch_id = $1 AND coin_type_id = $2
                  )
                  WHERE batch_id = $1 AND coin_type_id = $2
                `, [batchId, ctId]);
              }
            }
          } catch (err) {
            errors.push(`Failed to create batch ${batchData.batchName}: ${err.message}`);
          }
        }

        return res.json({
          success: true,
          batchesCreated,
          contributionsCreated,
          coinTypesCreated,
          errors: errors.length > 0 ? errors : undefined
        });
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
        await ensureCoinTypeColumns();
        const { name, shortCode, catalogId, description, createBoth, isUngraded } = req.body;
        if (!catalogId) return res.status(400).json({ error: 'Catalog ID required' });

        const results = [];

        if (createBoth) {
          // Create graded variant
          const gradedName = name || catalogId;
          const gradedCode = shortCode || catalogId;
          const graded = await query(
            `INSERT INTO coin_types (name, short_code, catalog_id, is_ungraded, description, keywords)
             VALUES ($1, $2, $3, false, $4, $5)
             ON CONFLICT (name) DO UPDATE SET
               short_code = EXCLUDED.short_code,
               catalog_id = EXCLUDED.catalog_id,
               is_ungraded = EXCLUDED.is_ungraded
             RETURNING *`,
            [gradedName, gradedCode, catalogId, description || null, [gradedName, catalogId]]
          );
          results.push(graded.rows[0]);

          // Create ungraded variant
          const ungradedName = `${name || catalogId} (Ungraded)`;
          const ungradedCode = `${shortCode || catalogId}-UNGRADED`;
          const ungraded = await query(
            `INSERT INTO coin_types (name, short_code, catalog_id, is_ungraded, description, keywords)
             VALUES ($1, $2, $3, true, $4, $5)
             ON CONFLICT (name) DO UPDATE SET
               short_code = EXCLUDED.short_code,
               catalog_id = EXCLUDED.catalog_id,
               is_ungraded = EXCLUDED.is_ungraded
             RETURNING *`,
            [ungradedName, ungradedCode, catalogId, description || null, [ungradedName, catalogId]]
          );
          results.push(ungraded.rows[0]);
        } else {
          // Create single variant
          const coinName = isUngraded ? `${name || catalogId} (Ungraded)` : (name || catalogId);
          const coinCode = isUngraded ? `${shortCode || catalogId}-UNGRADED` : (shortCode || catalogId);
          const result = await query(
            `INSERT INTO coin_types (name, short_code, catalog_id, is_ungraded, description, keywords)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (name) DO UPDATE SET
               short_code = EXCLUDED.short_code,
               catalog_id = EXCLUDED.catalog_id,
               is_ungraded = EXCLUDED.is_ungraded
             RETURNING *`,
            [coinName, coinCode, catalogId, isUngraded || false, description || null, [coinName, catalogId]]
          );
          results.push(result.rows[0]);
        }

        return res.status(201).json(createBoth ? results : results[0]);
      }

      // Update coin type
      if (action === 'updateCoinType') {
        await ensureCoinTypeColumns();
        const { coinTypeId, name, shortCode, catalogId, description, isUngraded } = req.body;
        if (!coinTypeId) return res.status(400).json({ error: 'Coin type ID required' });

        const result = await query(
          `UPDATE coin_types SET
            name = COALESCE($1, name),
            short_code = $2,
            catalog_id = $3,
            description = $4,
            is_ungraded = $5
           WHERE coin_type_id = $6
           RETURNING *`,
          [name, shortCode || null, catalogId || null, description || null, isUngraded || false, coinTypeId]
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
      const { batchName, shipDate, grader, status, notes, coinPrices, contributionId, quantity } = req.body;

      // Update contribution (check this first since it doesn't need batchId in query)
      if (contributionId !== undefined) {
        if (quantity === 0) {
          // Delete if quantity is 0
          await query('DELETE FROM user_contributions WHERE id = $1', [contributionId]);
        } else {
          await query(
            'UPDATE user_contributions SET quantity = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
            [contributionId, quantity]
          );
        }

        // Recalculate batch_coins totals
        await query(`
          UPDATE batch_coins bc
          SET total_contributed = (
            SELECT COALESCE(SUM(uc.quantity), 0) 
            FROM user_contributions uc 
            WHERE uc.batch_id = bc.batch_id AND uc.coin_type_id = bc.coin_type_id
          )
        `);

        return res.json({ success: true });
      }

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

      return res.status(400).json({ error: 'Batch ID or Contribution ID required' });
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
