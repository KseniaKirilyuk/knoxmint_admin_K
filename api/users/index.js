import { query } from '../_lib/db.js';
import bcrypt from 'bcryptjs';
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
      
      // Check if user can be deleted (no unpaid contributions)
      if (action === 'canDelete' && userId) {
        // Get user's unpaid balance
        const contribResult = await query(`
          SELECT 
            uc.user_id,
            uc.batch_id,
            uc.coin_type_id,
            uc.quantity as user_contributed,
            bc.total_contributed as batch_pool,
            COALESCE(bc.cost_per_coin, 0) as cost_per_coin,
            COALESCE(bc.grading_cost_per_coin, 0) as grading_cost_per_coin,
            COALESCE(SUM(st.quantity_sold), 0) as total_sold,
            COALESCE(SUM(st.total_payout), 0) as ebay_payout
          FROM user_contributions uc
          LEFT JOIN batch_coins bc ON bc.batch_id = uc.batch_id AND bc.coin_type_id = uc.coin_type_id
          LEFT JOIN sales_transactions st ON st.batch_id = uc.batch_id 
            AND st.coin_type_id = uc.coin_type_id 
            AND COALESCE(st.is_refund, false) = false
          WHERE uc.user_id = $1 AND uc.quantity > 0
          GROUP BY uc.user_id, uc.batch_id, uc.coin_type_id, 
                   uc.quantity, bc.total_contributed, bc.cost_per_coin, bc.grading_cost_per_coin
        `, [userId]);
        
        // Calculate unpaid balance
        let totalEarned = 0;
        for (const row of contribResult.rows) {
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
            
            totalEarned += batchMemberPayout * sharePct;
          }
        }
        
        // Get total paid
        const paidResult = await query(
          `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payouts WHERE user_id = $1 AND status = 'Paid'`,
          [userId]
        );
        const totalPaid = parseFloat(paidResult.rows[0]?.total_paid) || 0;
        const unpaidBalance = Math.max(0, totalEarned - totalPaid);
        
        // Get total contributions
        const contribCountResult = await query(
          `SELECT COALESCE(SUM(quantity), 0) as total FROM user_contributions WHERE user_id = $1`,
          [userId]
        );
        const totalContributions = parseInt(contribCountResult.rows[0]?.total) || 0;
        
        return res.json({
          canDelete: unpaidBalance < 0.01 && totalContributions === 0,
          unpaidBalance: unpaidBalance.toFixed(2),
          totalContributions,
          totalEarned: totalEarned.toFixed(2),
          totalPaid: totalPaid.toFixed(2)
        });
      }
      
      const result = await query(
        'SELECT user_id, username, email, full_name, payment_info, role, is_active, created_at FROM users WHERE is_active = true ORDER BY username'
      );
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { username, email, password, fullName, paymentInfo, role } = req.body;
      if (!username) return res.status(400).json({ error: 'Username required' });

      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      
      const result = await query(
        `INSERT INTO users (username, email, password_hash, full_name, payment_info, role)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING user_id, username, email, full_name, role, is_active, created_at`,
        [username, email, passwordHash, fullName, paymentInfo, role || 'user']
      );
      return res.status(201).json(result.rows[0]);
    }

    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { userId, mergeIntoUserId } = req.query;
      if (!userId) return res.status(400).json({ error: 'User ID required' });
      
      // Prevent self-deletion
      if (parseInt(userId) === user.userId) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
      }
      
      // If merging, transfer contributions to target user
      if (mergeIntoUserId) {
        // Transfer contributions
        await query(`
          UPDATE user_contributions 
          SET user_id = $1 
          WHERE user_id = $2
        `, [mergeIntoUserId, userId]);
        
        // Transfer payouts
        await query(`
          UPDATE payouts 
          SET user_id = $1 
          WHERE user_id = $2
        `, [mergeIntoUserId, userId]);
      }
      
      // Archive (soft delete) the user
      await query(
        'UPDATE users SET is_active = false WHERE user_id = $1',
        [userId]
      );
      
      return res.json({ success: true, message: mergeIntoUserId ? 'User merged and archived' : 'User archived' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Users error:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
}
