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
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
        // Skip if no sale price
        if (!tx.salePrice || tx.salePrice <= 0) continue;

        // Check for duplicate by order number
        if (tx.orderNumber) {
          const existing = await query(
            'SELECT transaction_id FROM sales_transactions WHERE order_number = $1',
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
        const coinCost = coinType ? (parseFloat(coinType.original_price) || 0) : 0;

        // Calculate values
        const salePrice = parseFloat(tx.salePrice) || 0;
        const ebayFee = Math.abs(parseFloat(tx.ebayFee) || 0);
        const advertisingFee = Math.abs(parseFloat(tx.advertisingFee) || 0);
        const shippingCost = Math.abs(parseFloat(tx.shippingCost) || 0);
        const quantity = parseInt(tx.quantity) || 1;
        
        const totalPayout = parseFloat(tx.totalPayout) || (salePrice - ebayFee - advertisingFee);
        const totalCoinCost = coinCost * quantity;
        const profit = totalPayout - totalCoinCost;
        const profitShare = profit > 0 ? Math.max(0.33 * profit, 8) : 0;
        const payout = profit - profitShare;
        const profitMargin = salePrice > 0 ? (profit / salePrice) : 0;

        // Insert transaction
        await query(`
          INSERT INTO sales_transactions (
            coin_type_id, listing_id, order_number, item_title, sale_date,
            sale_price, ebay_fee, advertising_fee, shipping_cost, total_payout,
            coin_cost, profit, profit_share, payout, profit_margin,
            grade, quantity_sold, imported_from
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
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
          profit,
          profitShare,
          payout,
          profitMargin,
          tx.grade || null,
          quantity,
          'ebay_upload'
        ]);

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
