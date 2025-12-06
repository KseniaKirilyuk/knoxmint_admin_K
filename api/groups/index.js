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
      const { action, groupId } = req.query;

      // Get members of a specific group
      if (action === 'members' && groupId) {
        const result = await query(`
          SELECT DISTINCT u.user_id, u.username, u.email, u.full_name
          FROM users u
          INNER JOIN user_contributions uc ON u.user_id = uc.user_id
          WHERE uc.group_id = $1
          ORDER BY u.full_name, u.username
        `, [groupId]);
        return res.json(result.rows);
      }

      // Get all groups with stats
      const result = await query(`
        SELECT 
          g.*,
          COUNT(DISTINCT uc.user_id) as member_count,
          COUNT(DISTINCT st.transaction_id) as transaction_count,
          COALESCE(SUM(st.profit), 0) as total_profit
        FROM groups g
        LEFT JOIN user_contributions uc ON g.group_id = uc.group_id
        LEFT JOIN sales_transactions st ON g.group_id = st.group_id
        GROUP BY g.group_id
        ORDER BY g.group_name
      `);
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { action, groupId, userId, groupName, grader, labelType, profitSharePercentage, profitShareMinimum, profitShareMaximum, description } = req.body;

      // Add member to group
      if (action === 'addMember') {
        if (!groupId || !userId) return res.status(400).json({ error: 'Group ID and User ID required' });
        
        // Check if already a member
        const existing = await query(
          'SELECT id FROM user_contributions WHERE user_id = $1 AND group_id = $2',
          [userId, groupId]
        );
        if (existing.rows.length > 0) {
          return res.status(400).json({ error: 'User is already a member of this group' });
        }

        await query(
          'INSERT INTO user_contributions (user_id, group_id, quantity) VALUES ($1, $2, 0)',
          [userId, groupId]
        );
        return res.json({ success: true, message: 'Member added' });
      }

      // Remove member from group
      if (action === 'removeMember') {
        if (!groupId || !userId) return res.status(400).json({ error: 'Group ID and User ID required' });
        
        await query(
          'DELETE FROM user_contributions WHERE user_id = $1 AND group_id = $2',
          [userId, groupId]
        );
        return res.json({ success: true, message: 'Member removed' });
      }

      // Create new group
      if (!groupName) return res.status(400).json({ error: 'Group name required' });

      const result = await query(
        `INSERT INTO groups (group_name, grader, label_type, profit_share_percentage, profit_share_minimum, profit_share_maximum, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [groupName, grader, labelType, profitSharePercentage || 0.33, profitShareMinimum || 8.00, profitShareMaximum || null, description]
      );
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Groups error:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'Group name already exists' });
    res.status(500).json({ error: 'Server error' });
  }
}
