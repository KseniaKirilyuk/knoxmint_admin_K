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
        // Get all user contributions with batch info
        const contribResult = await query(`
          SELECT 
            uc.user_id,
            u.username,
            u.full_name,
            uc.batch_id,
            uc.coin_type_id,
            uc.quantity as user_contributed,
            bc.total_contributed as batch_pool,
            COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
            COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin,
            COALESCE(SUM(st.quantity_sold), 0) as total_sold,
            COALESCE(SUM(st.total_payout), 0) as ebay_payout
          FROM user_contributions uc
          JOIN users u ON uc.user_id = u.user_id
          LEFT JOIN batch_coins bc ON bc.batch_id = uc.batch_id AND bc.coin_type_id = uc.coin_type_id
          LEFT JOIN sales_transactions st ON st.batch_id = uc.batch_id 
            AND st.coin_type_id = uc.coin_type_id 
            AND COALESCE(st.is_refund, false) = false
          WHERE uc.quantity > 0
          GROUP BY uc.user_id, u.username, u.full_name, uc.batch_id, uc.coin_type_id, 
                   uc.quantity, bc.total_contributed, bc.cost_per_coin, bc.grading_cost_per_coin
        `);
        
        // Get payments made
        const paymentsResult = await query(`
          SELECT user_id, COALESCE(SUM(amount), 0) as total_paid
          FROM payouts WHERE status = 'Paid'
          GROUP BY user_id
        `);
        const payments = {};
        paymentsResult.rows.forEach(r => payments[r.user_id] = parseFloat(r.total_paid) || 0);
        
        // Aggregate by user, calculating on the fly
        const userMap = {};
        
        for (const row of contribResult.rows) {
          const userId = row.user_id;
          if (!userMap[userId]) {
            userMap[userId] = {
              user_id: userId,
              username: row.username,
              full_name: row.full_name,
              total_contributed: 0,
              total_earned: 0
            };
          }
          
          userMap[userId].total_contributed += parseInt(row.user_contributed) || 0;
          
          const sold = parseInt(row.total_sold) || 0;
          if (sold > 0) {
            const userContributed = parseInt(row.user_contributed) || 0;
            const batchPool = parseInt(row.batch_pool) || 0;
            const sharePct = batchPool > 0 ? (userContributed / batchPool) : 0;
            
            const ebayPayout = parseFloat(row.ebay_payout) || 0;
            const costPerCoin = parseFloat(row.cost_per_coin) || 0;
            const gradingCostPerCoin = parseFloat(row.grading_cost_per_coin) || 0;
            
            const totalCoinCost = costPerCoin * sold;
            const totalGradingCost = gradingCostPerCoin * sold;
            const batchProfit = ebayPayout - totalCoinCost - totalGradingCost;
            const adminShare = Math.max(0.33 * batchProfit, 8 * sold);
            const batchMemberPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare);
            
            userMap[userId].total_earned += batchMemberPayout * sharePct;
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
      // Calculate profit on the fly using current batch_coins costs (matching batch payouts)
      if (action === 'memberBreakdown' && userId) {
        // Get user's contributions with batch pool info
        const result = await query(`
          SELECT 
            b.batch_id,
            b.batch_name,
            b.ship_date,
            ct.coin_type_id,
            ct.name as coin_type_name,
            ct.is_ungraded,
            uc.quantity as user_contributed,
            bc.total_contributed as batch_pool,
            COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
            COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin,
            COALESCE(SUM(st.quantity_sold), 0) as total_sold,
            COALESCE(SUM(st.total_payout), 0) as ebay_payout,
            COALESCE(SUM(st.coin_cost), 0) as total_coin_cost_stored
          FROM user_contributions uc
          JOIN batches b ON uc.batch_id = b.batch_id
          JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
          LEFT JOIN batch_coins bc ON bc.batch_id = uc.batch_id AND bc.coin_type_id = uc.coin_type_id
          LEFT JOIN sales_transactions st ON st.batch_id = uc.batch_id 
            AND st.coin_type_id = uc.coin_type_id 
            AND COALESCE(st.is_refund, false) = false
          WHERE uc.user_id = $1 AND uc.quantity > 0
          GROUP BY b.batch_id, b.batch_name, b.ship_date, ct.coin_type_id, ct.name, ct.is_ungraded, 
                   uc.quantity, bc.total_contributed, bc.cost_per_coin, bc.grading_cost_per_coin
          ORDER BY b.ship_date DESC NULLS LAST, ct.name
        `, [userId]);
        
        // Calculate on the fly (matching batch payouts logic)
        const rows = result.rows.map(row => {
          const userContributed = parseInt(row.user_contributed) || 0;
          const batchPool = parseInt(row.batch_pool) || 0;
          const sold = parseInt(row.total_sold) || 0;
          const ebayPayout = parseFloat(row.ebay_payout) || 0;
          const costPerCoin = parseFloat(row.cost_per_coin) || 0;
          const gradingCostPerCoin = parseFloat(row.grading_cost_per_coin) || 0;
          
          // Share % based on batch pool contribution
          const sharePct = batchPool > 0 ? (userContributed / batchPool) : 0;
          
          // Calculate batch profit using current costs (same as batch payouts)
          const totalCoinCost = costPerCoin * sold;
          const totalGradingCost = gradingCostPerCoin * sold;
          const batchProfit = ebayPayout - totalCoinCost - totalGradingCost;
          const adminShare = Math.max(0.33 * batchProfit, 8 * sold);
          const batchMemberPayout = Math.max(0, ebayPayout - totalGradingCost - adminShare);
          
          // Member's share of the batch payout
          const memberPayout = batchMemberPayout * sharePct;
          
          return {
            batch_id: row.batch_id,
            batch_name: row.batch_name,
            ship_date: row.ship_date,
            coin_type_id: row.coin_type_id,
            coin_type_name: row.coin_type_name,
            is_ungraded: row.is_ungraded,
            user_contributed: userContributed,
            batch_pool: batchPool,
            total_sold: sold,
            share_pct: (sharePct * 100).toFixed(1),
            batch_profit: batchProfit.toFixed(2),
            member_payout: memberPayout.toFixed(2)
          };
        });
        
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
