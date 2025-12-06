import { query } from '../_lib/db.js';
import jwt from 'jsonwebtoken';

function verifyToken(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch { return null; }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  const user = verifyToken(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { transactions, groupName } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Invalid data format' });
    }

    // Find or create group
    let groupResult = await query(
      'SELECT group_id, profit_share_percentage, profit_share_minimum, profit_share_maximum FROM groups WHERE group_name = $1',
      [groupName]
    );

    let groupId;
    let group;

    if (groupResult.rows.length === 0) {
      // Parse grader and label from group name (e.g., "NGC FDI" -> grader: NGC, label: FDI)
      const parts = groupName.split(' ');
      const grader = parts[0];
      const labelType = parts.slice(1).join(' ');

      const newGroup = await query(
        `INSERT INTO groups (group_name, grader, label_type, profit_share_percentage, profit_share_minimum)
         VALUES ($1, $2, $3, 0.33, 8.00)
         RETURNING group_id, profit_share_percentage, profit_share_minimum, profit_share_maximum`,
        [groupName, grader, labelType]
      );
      groupId = newGroup.rows[0].group_id;
      group = newGroup.rows[0];
    } else {
      groupId = groupResult.rows[0].group_id;
      group = groupResult.rows[0];
    }

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const tx of transactions) {
      try {
        // Skip if listing already exists
        if (tx.listingId) {
          const existing = await query(
            'SELECT transaction_id FROM sales_transactions WHERE listing_id = $1',
            [tx.listingId]
          );
          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }
        }

        // Calculate values
        const salePrice = parseFloat(tx.salePrice) || 0;
        const ebayFee = parseFloat(tx.ebayFee) || 0;
        const advertisingFee = parseFloat(tx.advertisingFee) || 0;
        const shippingCost = parseFloat(tx.shippingCost) || 0;
        const coinCost = parseFloat(tx.coinCost) || 0;

        const totalPayout = salePrice - ebayFee - advertisingFee - shippingCost;
        const profit = totalPayout - coinCost;

        // Calculate profit share
        let profitShare = profit * parseFloat(group.profit_share_percentage);
        profitShare = Math.max(profitShare, parseFloat(group.profit_share_minimum));
        if (group.profit_share_maximum) {
          profitShare = Math.min(profitShare, parseFloat(group.profit_share_maximum));
        }

        // Use provided profit_share if available
        if (tx.profitShare !== undefined && tx.profitShare !== null) {
          profitShare = parseFloat(tx.profitShare);
        }

        await query(
          `INSERT INTO sales_transactions 
           (group_id, listing_id, sale_date, sale_price, ebay_fee, advertising_fee, shipping_cost, total_payout, coin_cost, profit, profit_share, imported_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            groupId,
            tx.listingId || null,
            tx.saleDate || new Date().toISOString().split('T')[0],
            salePrice,
            ebayFee,
            advertisingFee,
            shippingCost,
            totalPayout,
            coinCost,
            profit,
            profitShare,
            'Excel Import'
          ]
        );
        imported++;
      } catch (err) {
        errors.push(`Row error: ${err.message}`);
      }
    }

    res.json({
      success: true,
      imported,
      skipped,
      errors: errors.slice(0, 10), // Return first 10 errors
      groupId,
      groupName
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Import failed: ' + error.message });
  }
}
