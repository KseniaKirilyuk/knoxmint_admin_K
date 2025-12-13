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
    const { transactions, coinMappings } = req.body;
    
    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Transactions array required' });
    }

    // Get all coin types for lookup
    const coinTypesResult = await query('SELECT * FROM coin_types');
    const coinTypes = coinTypesResult.rows;

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

        // Find coin type - check mapping first, then by name
        let coinTypeId = null;
        let coinCost = 0;
        
        if (tx.coinType) {
          // Check if manually mapped
          if (coinMappings && coinMappings[tx.coinType]) {
            coinTypeId = coinMappings[tx.coinType];
            const ct = coinTypes.find(c => c.coin_type_id === coinTypeId);
            if (ct) {
              coinCost = parseFloat(ct.original_price) || 0;
            }
          } else {
            // Find by name match
            const ct = coinTypes.find(c => 
              c.name.toLowerCase() === tx.coinType.toLowerCase() ||
              c.short_code?.toLowerCase() === tx.coinType.toLowerCase()
            );
            if (ct) {
              coinTypeId = ct.coin_type_id;
              coinCost = parseFloat(ct.original_price) || 0;
            }
          }
        }

        // Calculate values
        const salePrice = parseFloat(tx.salePrice) || 0;
        const ebayFee = Math.abs(parseFloat(tx.ebayFee) || 0);
        const advertisingFee = Math.abs(parseFloat(tx.advertisingFee) || 0);
        const shippingCost = Math.abs(parseFloat(tx.shippingCost) || 0);
        const quantity = parseInt(tx.quantity) || 1;
        
        // Total payout = Net from eBay (already includes fees taken out)
        const totalPayout = parseFloat(tx.totalPayout) || (salePrice - ebayFee - advertisingFee);
        
        // Coin cost adjusted for quantity
        const totalCoinCost = coinCost * quantity;
        
        // Profit = Total Payout - Coin Cost
        const profit = totalPayout - totalCoinCost;
        
        // Profit Share = MAX(33% of profit, $8) - only if profit > 0
        const profitShare = profit > 0 ? Math.max(0.33 * profit, 8) : 0;
        
        // Payout to members
        const payout = profit - profitShare;
        
        // Profit margin
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

    // Update batch_coins sold counts if we have coin types
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
      errors: errors.slice(0, 10)
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
