import { sql } from '@vercel/postgres';
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
      
      let result;
      if (status) {
        result = await sql`
          SELECT p.*, u.username, u.full_name, g.group_name
          FROM payouts p
          JOIN users u ON p.user_id = u.user_id
          JOIN groups g ON p.group_id = g.group_id
          WHERE p.status = ${status}
          ORDER BY p.payout_date DESC, p.payout_id DESC
          LIMIT ${parseInt(limit)}
        `;
      } else {
        result = await sql`
          SELECT p.*, u.username, u.full_name, g.group_name
          FROM payouts p
          JOIN users u ON p.user_id = u.user_id
          JOIN groups g ON p.group_id = g.group_id
          ORDER BY p.payout_date DESC, p.payout_id DESC
          LIMIT ${parseInt(limit)}
        `;
      }
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { userId, groupId, amount, paymentMethod, paymentReference, notes } = req.body;

      const result = await sql`
        INSERT INTO payouts (user_id, group_id, payout_date, amount, status, payment_method, payment_reference, notes)
        VALUES (${userId}, ${groupId}, CURRENT_DATE, ${amount}, 'Pending', ${paymentMethod}, ${paymentReference}, ${notes})
        RETURNING *
      `;
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Payouts error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
