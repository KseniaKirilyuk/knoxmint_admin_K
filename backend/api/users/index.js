import { sql } from '@vercel/postgres';
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
      const result = await sql`
        SELECT user_id, username, email, full_name, payment_info, role, is_active, created_at
        FROM users ORDER BY username
      `;
      return res.json(result.rows);
    }

    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });
      
      const { username, email, password, fullName, paymentInfo, role } = req.body;
      if (!username) return res.status(400).json({ error: 'Username required' });

      const passwordHash = password ? await bcrypt.hash(password, 10) : null;
      
      const result = await sql`
        INSERT INTO users (username, email, password_hash, full_name, payment_info, role)
        VALUES (${username}, ${email}, ${passwordHash}, ${fullName}, ${paymentInfo}, ${role || 'user'})
        RETURNING user_id, username, email, full_name, role, is_active, created_at
      `;
      return res.status(201).json(result.rows[0]);
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Users error:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'Username or email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
}
