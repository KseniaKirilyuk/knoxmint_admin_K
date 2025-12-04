require('dotenv').config({ path: '../.env' });
const bcrypt = require('bcryptjs');
const db = require('../config/database');

async function seedDatabase() {
  try {
    console.log('🌱 Seeding database...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    await db.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ('admin', 'admin@knoxmint.com', $1, 'Admin User', 'admin')
      ON CONFLICT (username) DO NOTHING
    `, [adminPassword]);

    // Create sample users (from your Excel data)
    const users = [
      { username: 'nickj', full_name: 'Nicholas Johnson' },
      { username: 'mike2212581', full_name: 'Villa Ventures LLC' },
      { username: 'danfromsanfran', full_name: 'Doug Harris' },
      { username: 'Adam', full_name: 'Adam Sferlazzo' },
      { username: 'Pointerbrother', full_name: 'Benjamin Breuninger' },
      { username: 'Will', full_name: 'Will Chen' },
      { username: 'lross', full_name: 'Lonny Rossman' },
      { username: 'Greg2', full_name: 'Gregory Hobart' },
      { username: 'jho', full_name: 'Jeremy Ho' },
      { username: 'linkin06', full_name: 'Jonathan Huang' },
      { username: 'Jordan', full_name: 'Jordan Lamberg' },
      { username: 'EricL', full_name: 'Eric Lai' },
      { username: 'riley', full_name: 'Mdw Brokerage' },
      { username: 'Jey', full_name: 'Hyun Jey Cho' },
      { username: 'CMCW', full_name: 'Christopher Clark' },
      { username: 'Michael', full_name: 'Michael Weiss Wealthfront' },
      { username: 'MikeG', full_name: 'Mikhail Galbmillon' },
      { username: 'Fet', full_name: 'Ruslan Kras' }
    ];

    for (const user of users) {
      await db.query(`
        INSERT INTO users (username, full_name, role)
        VALUES ($1, $2, 'user')
        ON CONFLICT (username) DO NOTHING
      `, [user.username, user.full_name]);
    }
    console.log('  ✓ Users created');

    // Create mint products (2023 Morgan & Peace)
    const products = [
      { year: 2023, design: 'Morgan', finish: 'Uncirculated', catalog: '23XE', metal: 'Silver', weight: 1.0 },
      { year: 2023, design: 'Peace', finish: 'Uncirculated', catalog: '23XH', metal: 'Silver', weight: 1.0 },
      { year: 2023, design: 'Morgan', finish: 'Proof', catalog: '23XF', metal: 'Silver', weight: 1.0 },
      { year: 2023, design: 'Peace', finish: 'Proof', catalog: '23XL', metal: 'Silver', weight: 1.0 },
      { year: 2023, design: 'Two-Coin Set', finish: 'Uncirculated', catalog: '23X2', metal: 'Silver', weight: 2.0 },
      { year: 2023, design: 'Two-Coin Set', finish: 'Reverse Proof', catalog: '23XS', metal: 'Silver', weight: 2.0 }
    ];

    for (const p of products) {
      await db.query(`
        INSERT INTO mint_products (year, design, finish, mint_catalog_number, metal_type, weight_oz)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
      `, [p.year, p.design, p.finish, p.catalog, p.metal, p.weight]);
    }
    console.log('  ✓ Mint products created');

    // Create groups (from your Excel tabs)
    const groups = [
      { name: 'NGC FDI', grader: 'NGC', label: 'FDI' },
      { name: 'NGC FR', grader: 'NGC', label: 'FR' },
      { name: 'PCGS RP FS', grader: 'PCGS', label: 'FS' },
      { name: 'NGC RP FDI', grader: 'NGC', label: 'FDI' },
      { name: 'PCGS PR FDI', grader: 'PCGS', label: 'FDI' },
      { name: 'PCGS FDI', grader: 'PCGS', label: 'FDI' }
    ];

    for (const g of groups) {
      await db.query(`
        INSERT INTO groups (group_name, grader, label_type, profit_share_percentage, profit_share_minimum)
        VALUES ($1, $2, $3, 0.33, 8.00)
        ON CONFLICT (group_name) DO NOTHING
      `, [g.name, g.grader, g.label]);
    }
    console.log('  ✓ Groups created');

    // Create sample grading batch
    await db.query(`
      INSERT INTO grading_batches (grader, submission_date, return_date, total_grading_cost, coins_submitted, notes)
      VALUES ('NGC', '2023-07-15', '2023-07-25', 9110.30, 500, 'Initial NGC batch')
      ON CONFLICT DO NOTHING
    `);
    console.log('  ✓ Grading batches created');

    // Create sample graded coins
    const gradedCoins = [
      { product_id: 1, grader: 'NGC', grade: '70', label: 'FDI', quantity: 150, raw: 67, grading: 28, total: 95 },
      { product_id: 1, grader: 'NGC', grade: '69', label: 'FDI', quantity: 300, raw: 67, grading: 17, total: 84 },
      { product_id: 2, grader: 'NGC', grade: '70', label: 'FDI', quantity: 120, raw: 67, grading: 28, total: 95 },
      { product_id: 2, grader: 'NGC', grade: '69', label: 'FDI', quantity: 250, raw: 67, grading: 17, total: 84 },
      { product_id: 5, grader: 'NGC', grade: '70', label: 'FDI', quantity: 200, raw: 134, grading: 56, total: 190 },
      { product_id: 5, grader: 'NGC', grade: '69', label: 'FDI', quantity: 180, raw: 134, grading: 34, total: 168 }
    ];

    for (const c of gradedCoins) {
      await db.query(`
        INSERT INTO graded_coins (product_id, batch_id, grader, grade, label_type, quantity, raw_cost_per_coin, grading_cost_per_coin, total_cost_per_coin)
        VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)
      `, [c.product_id, c.grader, c.grade, c.label, c.quantity, c.raw, c.grading, c.total]);
    }
    console.log('  ✓ Graded coins created');

    console.log('');
    console.log('✅ Database seeded successfully!');
    console.log('');
    console.log('Admin login:');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
    process.exit(1);
  }
}

seedDatabase();
