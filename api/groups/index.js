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
      
      const { groupName, grader, labelType, profitSharePercentage, profitShareMinimum, profitShareMaximum, description } = req.body;
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
