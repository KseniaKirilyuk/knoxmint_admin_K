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

  try {
    if (req.method === 'GET') {
      const { action, userId } = req.query;

      // Get member totals
      if (action === 'memberTotals') {
        // Get all user contributions with catalog_id
        const contribResult = await query(`
          SELECT 
            uc.user_id,
            u.username,
            u.full_name,
            uc.batch_id,
            ct.catalog_id,
            uc.quantity as user_contributed
          FROM user_contributions uc
          JOIN users u ON uc.user_id = u.user_id
          JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
          WHERE uc.quantity > 0
        `);
        
        // Get payments made
        const paymentsResult = await query(`
          SELECT user_id, COALESCE(SUM(amount), 0) as total_paid
          FROM payouts WHERE status = 'Paid'
          GROUP BY user_id
        `);
        const payments = {};
        paymentsResult.rows.forEach(r => payments[r.user_id] = parseFloat(r.total_paid) || 0);
        
        // Group contributions by user + batch + catalog_id
        const contribMap = {};
        for (const row of contribResult.rows) {
          const key = `${row.user_id}-${row.batch_id}-${row.catalog_id}`;
          if (!contribMap[key]) {
            contribMap[key] = {
              user_id: row.user_id,
              username: row.username,
              full_name: row.full_name,
              batch_id: row.batch_id,
              catalog_id: row.catalog_id,
              user_contributed: 0
            };
          }
          contribMap[key].user_contributed += parseInt(row.user_contributed) || 0;
        }
        
        // Calculate earnings per user
        const userMap = {};
        
        for (const contrib of Object.values(contribMap)) {
          const userId = contrib.user_id;
          if (!userMap[userId]) {
            userMap[userId] = {
              user_id: userId,
              username: contrib.username,
              full_name: contrib.full_name,
              total_contributed: 0,
              total_earned: 0
            };
          }
          
          userMap[userId].total_contributed += contrib.user_contributed;
          
          // Get total batch contributions for this catalog_id
          const batchTotalResult = await query(`
            SELECT COALESCE(SUM(uc.quantity), 0) as total_batch
            FROM user_contributions uc
            JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
            WHERE uc.batch_id = $1 AND ct.catalog_id = $2
          `, [contrib.batch_id, contrib.catalog_id]);
          
          const totalBatch = parseInt(batchTotalResult.rows[0]?.total_batch) || 0;
          const sharePct = totalBatch > 0 ? (contrib.user_contributed / totalBatch) : 0;
          
          // Get ALL coin types with this catalog_id (graded + ungraded)
          const coinTypesResult = await query(`
            SELECT ct.coin_type_id, ct.is_ungraded,
                   COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
                   COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin
            FROM coin_types ct
            LEFT JOIN batch_coins bc ON bc.coin_type_id = ct.coin_type_id AND bc.batch_id = $1
            WHERE ct.catalog_id = $2
          `, [contrib.batch_id, contrib.catalog_id]);
          
          for (const coinType of coinTypesResult.rows) {
            // Get sales for this coin type in this batch
            const salesResult = await query(`
              SELECT 
                COALESCE(SUM(quantity_sold), 0) as sold,
                COALESCE(SUM(total_payout), 0) as ebay_payout
              FROM sales_transactions
              WHERE batch_id = $1 AND coin_type_id = $2 AND COALESCE(is_refund, false) = false
            `, [contrib.batch_id, coinType.coin_type_id]);
            
            const sold = parseInt(salesResult.rows[0]?.sold) || 0;
            const ebayPayout = parseFloat(salesResult.rows[0]?.ebay_payout) || 0;
            
            if (sold > 0) {
              const costPerCoin = parseFloat(coinType.cost_per_coin) || 0;
              const gradingCostPerCoin = parseFloat(coinType.grading_cost_per_coin) || 0;
              
              const totalCoinCost = costPerCoin * sold;
              const totalGradingCost = gradingCostPerCoin * sold;
              const profit = ebayPayout - totalCoinCost - totalGradingCost;
              const adminShare = Math.max(0.33 * profit, 8 * sold);
              const batchMembersPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare);
              
              userMap[userId].total_earned += batchMembersPayout * sharePct;
            }
          }
        }
        
        // Convert to array and add payment info
        const rows = Object.values(userMap).map(u => ({
          ...u,
          total_earned: u.total_earned.toFixed(2),
          total_paid: (payments[u.user_id] || 0).toFixed(2),
          balance: Math.max(0, u.total_earned - (payments[u.user_id] || 0)).toFixed(2)
        })).filter(u => u.total_contributed > 0 || parseFloat(u.total_earned) > 0)
          .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));
        
        return res.json(rows);
      }

      // Get breakdown for a specific member
      // Calculate profit on the fly, include both graded and ungraded sales
      if (action === 'memberBreakdown' && userId) {
        // Get user's contributions with catalog_id to link graded/ungraded
        const contribResult = await query(`
          SELECT 
            uc.batch_id,
            b.batch_name,
            b.ship_date,
            ct.catalog_id,
            ct.name as coin_type_name,
            uc.quantity as user_contributed
          FROM user_contributions uc
          JOIN batches b ON uc.batch_id = b.batch_id
          JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
          WHERE uc.user_id = $1 AND uc.quantity > 0
          ORDER BY b.ship_date DESC NULLS LAST, ct.name
        `, [userId]);
        
        const rows = [];
        
        for (const contrib of contribResult.rows) {
          // Get total batch contributions for this catalog_id
          const batchTotalResult = await query(`
            SELECT COALESCE(SUM(uc.quantity), 0) as total_batch
            FROM user_contributions uc
            JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
            WHERE uc.batch_id = $1 AND ct.catalog_id = $2
          `, [contrib.batch_id, contrib.catalog_id]);
          
          const totalBatch = parseInt(batchTotalResult.rows[0]?.total_batch) || 0;
          const userContributed = parseInt(contrib.user_contributed) || 0;
          const sharePct = totalBatch > 0 ? (userContributed / totalBatch) : 0;
          
          // Get ALL coin types with this catalog_id (graded + ungraded)
          const coinTypesResult = await query(`
            SELECT ct.coin_type_id, ct.name, ct.is_ungraded, 
                   COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
                   COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin
            FROM coin_types ct
            LEFT JOIN batch_coins bc ON bc.coin_type_id = ct.coin_type_id AND bc.batch_id = $1
            WHERE ct.catalog_id = $2
          `, [contrib.batch_id, contrib.catalog_id]);
          
          let totalSold = 0;
          let totalBatchMembersPayout = 0;
          let gradedSold = 0;
          let gradedBatchPayout = 0;
          let ungradedSold = 0;
          let ungradedBatchPayout = 0;
          
          for (const coinType of coinTypesResult.rows) {
            // Get sales for this coin type in this batch
            const salesResult = await query(`
              SELECT 
                COALESCE(SUM(quantity_sold), 0) as sold,
                COALESCE(SUM(total_payout), 0) as ebay_payout
              FROM sales_transactions
              WHERE batch_id = $1 AND coin_type_id = $2 AND COALESCE(is_refund, false) = false
            `, [contrib.batch_id, coinType.coin_type_id]);
            
            const sold = parseInt(salesResult.rows[0]?.sold) || 0;
            const ebayPayout = parseFloat(salesResult.rows[0]?.ebay_payout) || 0;
            
            if (sold > 0) {
              const costPerCoin = parseFloat(coinType.cost_per_coin) || 0;
              const gradingCostPerCoin = parseFloat(coinType.grading_cost_per_coin) || 0;
              
              const totalCoinCost = costPerCoin * sold;
              const totalGradingCost = gradingCostPerCoin * sold;
              const profit = ebayPayout - totalCoinCost - totalGradingCost;
              const adminShare = Math.max(0.33 * profit, 8 * sold);
              const batchMembersPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare);
              
              totalSold += sold;
              totalBatchMembersPayout += batchMembersPayout;
              
              if (coinType.is_ungraded) {
                ungradedSold += sold;
                ungradedBatchPayout += batchMembersPayout;
              } else {
                gradedSold += sold;
                gradedBatchPayout += batchMembersPayout;
              }
            }
          }
          
          // Member's payout from sold coins
          const memberPayout = totalBatchMembersPayout * sharePct;
          
          // Pending = member's coins that haven't sold yet
          const memberPending = Math.max(0, userContributed - totalSold);
          
          rows.push({
            batch_id: contrib.batch_id,
            batch_name: contrib.batch_name,
            ship_date: contrib.ship_date,
            catalog_id: contrib.catalog_id,
            coin_type_name: contrib.coin_type_name,
            user_contributed: userContributed,
            total_batch: totalBatch,
            share_pct: (sharePct * 100).toFixed(2),
            total_sold: totalSold,
            graded_sold: gradedSold,
            graded_batch_payout: gradedBatchPayout.toFixed(2),
            ungraded_sold: ungradedSold,
            ungraded_batch_payout: ungradedBatchPayout.toFixed(2),
            batch_members_payout: totalBatchMembersPayout.toFixed(2),
            member_payout: memberPayout.toFixed(2),
            member_pending: memberPending
          });
        }
        
        return res.json(rows);
      }

      // Get payment history
      if (action === 'history') {
        const result = await query(`
          SELECT p.*, u.username, u.full_name
          FROM payouts p
          JOIN users u ON p.user_id = u.user_id
          ORDER BY p.payout_date DESC, p.created_at DESC
          LIMIT 100
        `);
        return res.json(result.rows);
      }

      // Get batch totals for payout overview
      if (action === 'batchTotals') {
        // Get basic batch info
        const result = await query(`
          SELECT 
            b.batch_id,
            b.batch_name,
            b.ship_date,
            (SELECT COUNT(DISTINCT user_id) FROM user_contributions WHERE batch_id = b.batch_id) as contributor_count,
            (SELECT COALESCE(SUM(total_contributed), 0) FROM batch_coins WHERE batch_id = b.batch_id) as total_coins,
            COALESCE(SUM(st.quantity_sold), 0) as total_sold,
            COALESCE(SUM(st.total_payout), 0) as total_ebay_payout
          FROM batches b
          LEFT JOIN sales_transactions st ON b.batch_id = st.batch_id AND COALESCE(st.is_refund, false) = false
          GROUP BY b.batch_id, b.batch_name, b.ship_date
          ORDER BY b.ship_date DESC NULLS LAST
        `);
        
        // For each batch, calculate using CURRENT batch_coins costs (matching Sales page)
        const batchesWithCalcs = await Promise.all(result.rows.map(async (batch) => {
          // Get sales grouped by coin type, with current batch_coins costs
          const salesResult = await query(`
            SELECT 
              st.coin_type_id,
              SUM(st.quantity_sold) as qty,
              SUM(st.total_payout) as ebay_payout,
              COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
              COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin
            FROM sales_transactions st
            LEFT JOIN batch_coins bc ON bc.batch_id = st.batch_id AND bc.coin_type_id = st.coin_type_id
            WHERE st.batch_id = $1 AND COALESCE(st.is_refund, false) = false
            GROUP BY st.coin_type_id, bc.cost_per_coin, bc.grading_cost_per_coin
          `, [batch.batch_id]);
          
          // Calculate totals using CURRENT batch_coins values (same as Sales page)
          let totalProfit = 0;
          let totalAdminShare = 0;
          let totalMemberPayout = 0;
          
          for (const row of salesResult.rows) {
            const ebayPayout = parseFloat(row.ebay_payout) || 0;
            const qty = parseInt(row.qty) || 0;
            const costPerCoin = parseFloat(row.cost_per_coin) || 0;
            const gradingCostPerCoin = parseFloat(row.grading_cost_per_coin) || 0;
            
            // Use current batch_coins values × quantity
            const totalCoinCost = costPerCoin * qty;
            const totalGradingCost = gradingCostPerCoin * qty;
            
            const profit = ebayPayout - totalCoinCost - totalGradingCost;
            const adminShare = Math.max(0.33 * profit, 8 * qty);
            const memberPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare);
            
            totalProfit += profit;
            totalAdminShare += adminShare;
            totalMemberPayout += memberPayout;
          }
          
          return {
            ...batch,
            total_profit: totalProfit.toFixed(2),
            total_admin_share: totalAdminShare.toFixed(2),
            total_member_profit: (totalProfit - totalAdminShare).toFixed(2),
            total_member_payout: totalMemberPayout.toFixed(2)
          };
        }));
        
        return res.json(batchesWithCalcs);
      }

      // Get breakdown for a specific batch
      if (action === 'batchBreakdown') {
        const { batchId } = req.query;
        if (!batchId) return res.status(400).json({ error: 'Batch ID required' });
        
        // Get raw sales data - use batch_coins for current costs (not stored st.coin_cost)
        const result = await query(`
          SELECT 
            st.coin_type_id,
            ct.name as coin_type_name,
            ct.is_ungraded,
            COALESCE(bc.total_contributed, 0) as pool,
            COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
            COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin,
            SUM(st.quantity_sold) as sold,
            SUM(st.total_payout) as ebay_payout
          FROM sales_transactions st
          JOIN coin_types ct ON st.coin_type_id = ct.coin_type_id
          LEFT JOIN batch_coins bc ON bc.batch_id = st.batch_id AND bc.coin_type_id = st.coin_type_id
          WHERE st.batch_id = $1 AND COALESCE(st.is_refund, false) = false
          GROUP BY st.coin_type_id, ct.name, ct.is_ungraded, bc.total_contributed, bc.cost_per_coin, bc.grading_cost_per_coin
          ORDER BY ct.name
        `, [batchId]);
        
        // Calculate using CURRENT batch_coins costs (matching Sales page logic)
        const rows = result.rows.map(row => {
          const ebayPayout = parseFloat(row.ebay_payout) || 0;
          const sold = parseInt(row.sold) || 0;
          const costPerCoin = parseFloat(row.cost_per_coin) || 0;
          const gradingCostPerCoin = parseFloat(row.grading_cost_per_coin) || 0;
          
          // Use current batch_coins values (same as Sales page)
          const totalCoinCost = costPerCoin * sold;
          const totalGradingCost = gradingCostPerCoin * sold;
          
          const profit = ebayPayout - totalCoinCost - totalGradingCost;
          const adminShare = Math.max(0.33 * profit, 8 * sold);
          const memberPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare);
          
          return {
            ...row,
            profit: profit.toFixed(2),
            admin_share: adminShare.toFixed(2),
            member_profit: (profit - adminShare).toFixed(2),
            member_payout: memberPayout.toFixed(2)
          };
        });
        
        return res.json(rows);
      }

      // Debug: Get raw sales for a batch (no aggregation)
      if (action === 'debugBatchSales') {
        const { batchId, coinTypeId } = req.query;
        if (!batchId) return res.status(400).json({ error: 'Batch ID required' });
        
        let sql = `
          SELECT 
            st.transaction_id,
            st.coin_type_id,
            ct.name as coin_type_name,
            st.quantity_sold,
            st.total_payout,
            st.coin_cost,
            st.grading_cost,
            st.profit,
            st.profit_share,
            st.payout
          FROM sales_transactions st
          JOIN coin_types ct ON st.coin_type_id = ct.coin_type_id
          WHERE st.batch_id = $1 AND COALESCE(st.is_refund, false) = false
        `;
        const params = [batchId];
        
        if (coinTypeId) {
          sql += ` AND st.coin_type_id = $2`;
          params.push(coinTypeId);
        }
        
        sql += ` ORDER BY st.sale_date`;
        
        const result = await query(sql, params);
        
        // Also return sums
        const sums = result.rows.reduce((acc, row) => ({
          total_payout: acc.total_payout + parseFloat(row.total_payout || 0),
          profit: acc.profit + parseFloat(row.profit || 0),
          profit_share: acc.profit_share + parseFloat(row.profit_share || 0),
          payout: acc.payout + parseFloat(row.payout || 0),
          count: acc.count + 1
        }), { total_payout: 0, profit: 0, profit_share: 0, payout: 0, count: 0 });
        
        return res.json({ sales: result.rows, sums });
      }

      return res.json([]);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { userId, amount, paymentMethod, paymentReference, notes } = req.body;

      if (!userId || !amount) {
        return res.status(400).json({ error: 'User ID and amount required' });
      }

      const result = await query(
        `INSERT INTO payouts (user_id, payout_date, amount, status, payment_method, payment_reference, notes)
         VALUES ($1, CURRENT_DATE, $2, 'Paid', $3, $4, $5)
         RETURNING *`,
        [userId, amount, paymentMethod || 'Manual', paymentReference, notes]
      );
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'PUT') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { payoutId, amount, paymentMethod, paymentReference, notes, payoutDate } = req.body;

      if (!payoutId) {
        return res.status(400).json({ error: 'Payout ID required' });
      }

      const result = await query(
        `UPDATE payouts 
         SET amount = COALESCE($2, amount),
             payment_method = COALESCE($3, payment_method),
             payment_reference = COALESCE($4, payment_reference),
             notes = COALESCE($5, notes),
             payout_date = COALESCE($6, payout_date)
         WHERE payout_id = $1
         RETURNING *`,
        [payoutId, amount, paymentMethod, paymentReference, notes, payoutDate]
      );
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Payout not found' });
      }
      return res.json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { payoutId } = req.query;

      if (!payoutId) {
        return res.status(400).json({ error: 'Payout ID required' });
      }

      await query('DELETE FROM payouts WHERE payout_id = $1', [payoutId]);
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
