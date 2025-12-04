require('dotenv').config({ path: '../.env' });
const fs = require('fs');
const path = require('path');
const db = require('../config/database');

async function initializeDatabase() {
  try {
    console.log('🔧 Initializing database...');
    
    // Read the schema file
    const schemaPath = path.join(__dirname, '../../..', 'database', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the schema
    await db.query(schema);
    
    console.log('✅ Database schema created successfully!');
    console.log('');
    console.log('Tables created:');
    console.log('  - users');
    console.log('  - mint_products');
    console.log('  - purchases');
    console.log('  - grading_batches');
    console.log('  - graded_coins');
    console.log('  - groups');
    console.log('  - group_inventory');
    console.log('  - user_contributions');
    console.log('  - sales_transactions');
    console.log('  - payouts');
    console.log('  - payout_items');
    console.log('');
    console.log('Run `npm run db:seed` to populate with sample data.');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    process.exit(1);
  }
}

initializeDatabase();
