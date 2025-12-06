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
      const { status, limit = 100 } = req.query;
      
      let sql = `
        SELECT p.*, u.username, u.full_name, g.group_name
        FROM payouts p
        JOIN users u ON p.user_id = u.user_id
        JOIN groups g ON p.group_id = g.group_id
      `;
      const params = [];

      if (status) {
        sql += ' WHERE p.status = $1';
        params.push(status);
      }
      
      sql += ` ORDER BY p.payout_date DESC, p.payout_id DESC LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));

      const result = await query(sql, params);
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { userId, groupId, amount, paymentMethod, paymentReference, notes } = req.body;

      const result = await query(
        `INSERT INTO payouts (user_id, group_id, payout_date, amount, status, payment_method, payment_reference, notes)
         VALUES ($1, $2, CURRENT_DATE, $3, 'Pending', $4, $5, $6)
         RETURNING *`,
        [userId, groupId, amount, paymentMethod, paymentReference, notes]
      );
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
