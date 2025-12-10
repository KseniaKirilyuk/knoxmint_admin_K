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
    // GET - Fetch contributions or coin types
    if (req.method === 'GET') {
      const { action, groupId } = req.query;

      // Get coin types
      if (action === 'coinTypes') {
        const result = await query('SELECT * FROM coin_types ORDER BY name');
        return res.json(result.rows);
      }

      if (groupId) {
        // Get contributions for a specific group with totals
        const result = await query(`
          SELECT 
            uc.id,
            uc.user_id,
            uc.group_id,
            uc.coin_type_id,
            uc.quantity,
            u.username,
            u.full_name,
            ct.name as coin_type_name,
            g.group_name,
            SUM(uc.quantity) OVER (PARTITION BY uc.coin_type_id) as coin_type_total
          FROM user_contributions uc
          JOIN users u ON uc.user_id = u.user_id
          JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
          JOIN groups g ON uc.group_id = g.group_id
          WHERE uc.group_id = $1
          ORDER BY ct.name, u.full_name
        `, [groupId]);
        return res.json(result.rows);
      }

      // Get all contributions
      const result = await query(`
        SELECT 
          uc.id,
          uc.user_id,
          uc.group_id,
          uc.coin_type_id,
          uc.quantity,
          u.username,
          u.full_name,
          ct.name as coin_type_name,
          g.group_name
        FROM user_contributions uc
        JOIN users u ON uc.user_id = u.user_id
        JOIN coin_types ct ON uc.coin_type_id = ct.coin_type_id
        JOIN groups g ON uc.group_id = g.group_id
        ORDER BY g.group_name, ct.name, u.full_name
      `);
      return res.json(result.rows);
    }

    // POST - Add/Update contribution or bulk upload
    if (req.method === 'POST') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { action, contributions, name, keywords, description } = req.body;

      // Add new coin type
      if (action === 'addCoinType') {
        if (!name) return res.status(400).json({ error: 'Name required' });
        const result = await query(
          'INSERT INTO coin_types (name, keywords, description) VALUES ($1, $2, $3) RETURNING *',
          [name, keywords || [name], description]
        );
        return res.status(201).json(result.rows[0]);
      }

      // Bulk upload contributions
      if (action === 'bulkUpload' && contributions) {
        let imported = 0;
        let errors = [];

        for (const contrib of contributions) {
          try {
            const { memberName, quantity, coinType, groupName } = contrib;

            // Find or create user
            let userResult = await query(
              'SELECT user_id FROM users WHERE username = $1 OR full_name = $1',
              [memberName]
            );
            
            let userId;
            if (userResult.rows.length === 0) {
              // Create user
              const newUser = await query(
                'INSERT INTO users (username, full_name, role) VALUES ($1, $2, $3) RETURNING user_id',
                [memberName.toLowerCase().replace(/\s+/g, ''), memberName, 'user']
              );
              userId = newUser.rows[0].user_id;
            } else {
              userId = userResult.rows[0].user_id;
            }

            // Find or create coin type
            let coinTypeResult = await query(
              'SELECT coin_type_id FROM coin_types WHERE LOWER(name) = LOWER($1)',
              [coinType]
            );
            
            let coinTypeId;
            if (coinTypeResult.rows.length === 0) {
              // Create coin type
              const newCoinType = await query(
                'INSERT INTO coin_types (name, keywords) VALUES ($1, $2) RETURNING coin_type_id',
                [coinType, [coinType]]
              );
              coinTypeId = newCoinType.rows[0].coin_type_id;
            } else {
              coinTypeId = coinTypeResult.rows[0].coin_type_id;
            }

            // Find group
            const groupResult = await query(
              'SELECT group_id FROM groups WHERE LOWER(group_name) = LOWER($1)',
              [groupName]
            );
            
            if (groupResult.rows.length === 0) {
              errors.push(`Group not found: ${groupName}`);
              continue;
            }
            const groupId = groupResult.rows[0].group_id;

            // Upsert contribution
            await query(`
              INSERT INTO user_contributions (user_id, group_id, coin_type_id, quantity)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (user_id, group_id, coin_type_id)
              DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
            `, [userId, groupId, coinTypeId, parseInt(quantity) || 0]);

            imported++;
          } catch (err) {
            errors.push(`Error: ${err.message}`);
          }
        }

        return res.json({ success: true, imported, errors: errors.slice(0, 10) });
      }

      // Single contribution add/update
      const { userId, groupId, coinTypeId, quantity } = req.body;
      if (!userId || !groupId || !coinTypeId) {
        return res.status(400).json({ error: 'userId, groupId, and coinTypeId required' });
      }

      await query(`
        INSERT INTO user_contributions (user_id, group_id, coin_type_id, quantity)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, group_id, coin_type_id)
        DO UPDATE SET quantity = $4, updated_at = CURRENT_TIMESTAMP
      `, [userId, groupId, coinTypeId, parseInt(quantity) || 0]);

      return res.json({ success: true });
    }

    // DELETE - Remove contribution
    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin required' });

      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'Contribution ID required' });

      await query('DELETE FROM user_contributions WHERE id = $1', [id]);
      return res.json({ success: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Contributions error:', error);
    if (error.code === '23505') return res.status(400).json({ error: 'Already exists' });
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
