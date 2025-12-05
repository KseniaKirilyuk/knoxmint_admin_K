// Run this script locally to seed your Vercel Postgres database
// Usage: POSTGRES_URL="your-vercel-postgres-url" node scripts/seedDb.js

import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';

async function seed() {
  try {
    console.log('🌱 Seeding database...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    await sql`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ('admin', 'admin@knoxmint.com', ${adminPassword}, 'Admin User', 'admin')
      ON CONFLICT (username) DO NOTHING
    `;
    console.log('  ✓ Admin user created');

    // Create sample users
    const users = [
      'nickj', 'mike2212581', 'danfromsanfran', 'Adam', 'Pointerbrother',
      'Will', 'lross', 'Greg2', 'jho', 'linkin06', 'Jordan', 'EricL',
      'riley', 'Jey', 'CMCW', 'Michael', 'MikeG', 'Fet'
    ];

    for (const username of users) {
      await sql`
        INSERT INTO users (username, role)
        VALUES (${username}, 'user')
        ON CONFLICT (username) DO NOTHING
      `;
    }
    console.log('  ✓ Sample users created');

    // Create mint products
    const products = [
      { year: 2023, design: 'Morgan', finish: 'Uncirculated', catalog: '23XE' },
      { year: 2023, design: 'Peace', finish: 'Uncirculated', catalog: '23XH' },
      { year: 2023, design: 'Morgan', finish: 'Proof', catalog: '23XF' },
      { year: 2023, design: 'Peace', finish: 'Proof', catalog: '23XL' },
      { year: 2023, design: 'Two-Coin Set', finish: 'Uncirculated', catalog: '23X2' },
      { year: 2023, design: 'Two-Coin Set', finish: 'Reverse Proof', catalog: '23XS' }
    ];

    for (const p of products) {
      await sql`
        INSERT INTO mint_products (year, design, finish, mint_catalog_number, metal_type, weight_oz)
        VALUES (${p.year}, ${p.design}, ${p.finish}, ${p.catalog}, 'Silver', 1.0)
        ON CONFLICT DO NOTHING
      `;
    }
    console.log('  ✓ Mint products created');

    // Create groups
    const groups = [
      { name: 'NGC FDI', grader: 'NGC', label: 'FDI' },
      { name: 'NGC FR', grader: 'NGC', label: 'FR' },
      { name: 'PCGS RP FS', grader: 'PCGS', label: 'FS' },
      { name: 'NGC RP FDI', grader: 'NGC', label: 'FDI' },
      { name: 'PCGS PR FDI', grader: 'PCGS', label: 'FDI' },
      { name: 'PCGS FDI', grader: 'PCGS', label: 'FDI' }
    ];

    for (const g of groups) {
      await sql`
        INSERT INTO groups (group_name, grader, label_type, profit_share_percentage, profit_share_minimum)
        VALUES (${g.name}, ${g.grader}, ${g.label}, 0.33, 8.00)
        ON CONFLICT (group_name) DO NOTHING
      `;
    }
    console.log('  ✓ Groups created');

    console.log('');
    console.log('✅ Database seeded successfully!');
    console.log('');
    console.log('Admin login:');
    console.log('  Username: admin');
    console.log('  Password: admin123');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

seed();
