// Migration: Move prices from coin_types to batch_coins.cost_per_coin
// Usage: DATABASE_URL="your-neon-url" node scripts/migrate-cost-per-coin.js

import pg from 'pg';

async function migrate() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔧 Running migration: cost_per_coin...');

    // Step 1: Add cost_per_coin column to batch_coins if it doesn't exist
    await pool.query(`
      ALTER TABLE batch_coins 
      ADD COLUMN IF NOT EXISTS cost_per_coin DECIMAL(10, 2)
    `);
    console.log('✅ Added cost_per_coin column to batch_coins');

    // Step 2: Migrate prices from coin_types.original_price to batch_coins.cost_per_coin
    const result = await pool.query(`
      UPDATE batch_coins bc
      SET cost_per_coin = ct.original_price
      FROM coin_types ct
      WHERE bc.coin_type_id = ct.coin_type_id
        AND bc.cost_per_coin IS NULL
        AND ct.original_price IS NOT NULL
    `);
    console.log(`✅ Migrated ${result.rowCount} batch coin prices from coin_types`);

    // Step 3: Remove old price columns from coin_types (optional - comment out if you want to keep them)
    try {
      await pool.query(`ALTER TABLE coin_types DROP COLUMN IF EXISTS original_price`);
      await pool.query(`ALTER TABLE coin_types DROP COLUMN IF EXISTS current_price`);
      await pool.query(`ALTER TABLE coin_types DROP COLUMN IF EXISTS year`);
      console.log('✅ Removed old price columns from coin_types');
    } catch (e) {
      console.log('⚠️  Could not remove old columns (may not exist):', e.message);
    }

    // Step 4: Remove old price columns from batch_coins
    try {
      await pool.query(`ALTER TABLE batch_coins DROP COLUMN IF EXISTS original_price`);
      await pool.query(`ALTER TABLE batch_coins DROP COLUMN IF EXISTS current_price`);
      console.log('✅ Removed old price columns from batch_coins');
    } catch (e) {
      console.log('⚠️  Could not remove old columns (may not exist):', e.message);
    }

    console.log('\n✅ Migration complete!');
    console.log('📝 Reminder: Set cost_per_coin for each coin type in each batch via the Batches page.');

  } catch (error) {
    console.error('❌ Migration error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
