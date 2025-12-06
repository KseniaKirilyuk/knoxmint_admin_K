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

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { limit = 10 } = req.query;

    const result = await query(`
      SELECT 
        st.transaction_id,
        st.listing_id,
        st.sale_date,
        st.sale_price,
        st.profit,
        g.group_name,
        mp.design,
        gc.grade
      FROM sales_transactions st
      JOIN groups g ON st.group_id = g.group_id
      LEFT JOIN graded_coins gc ON st.graded_coin_id = gc.graded_coin_id
      LEFT JOIN mint_products mp ON gc.product_id = mp.product_id
      ORDER BY st.sale_date DESC, st.transaction_id DESC
      LIMIT $1
    `, [parseInt(limit)]);

    res.json(result.rows);
  } catch (error) {
    console.error('Recent transactions error:', error);
    res.status(500).json({ error: 'Server error' });
  }
}
