// Seed the database with initial data
// Usage: DATABASE_URL="your-neon-url" node scripts/seedDb.js

import pg from 'pg';
import bcrypt from 'bcryptjs';

async function seed() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🌱 Seeding database...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    await pool.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ('admin', 'admin@knoxmint.com', $1, 'Admin User', 'admin')
      ON CONFLICT (username) DO NOTHING
    `, [adminPassword]);
    console.log('  ✓ Admin user created');

    // Create sample batch
    await pool.query(`
      INSERT INTO batches (batch_name, ship_date, grader, status)
      VALUES ('Sample Batch', CURRENT_DATE, 'NGC', 'Active')
      ON CONFLICT DO NOTHING
    `);
    console.log('  ✓ Sample batch created');

    console.log('');
    console.log('✅ Database seeded successfully!');
    console.log('');
    console.log('Admin login:');
    console.log('  Username: admin');
    console.log('  Password: admin123');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
