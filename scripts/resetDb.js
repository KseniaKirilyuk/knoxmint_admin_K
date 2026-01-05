import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

async function resetDb() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'data'; // 'data' or 'full'
  
  console.log(`\n🗑️  Database Reset Tool`);
  console.log(`Mode: ${mode === 'full' ? 'FULL (includes users)' : 'DATA ONLY (keeps users)'}\n`);
  
  try {
    if (mode === 'full') {
      // Full reset - delete everything except admin user
      console.log('Truncating all tables...');
      await pool.query(`
        TRUNCATE sales_transactions, user_contributions, batch_coins, payouts, coin_types, batches RESTART IDENTITY CASCADE
      `);
      
      console.log('Deleting non-admin users...');
      const deleteResult = await pool.query(`DELETE FROM users WHERE role != 'admin'`);
      console.log(`  Deleted ${deleteResult.rowCount} users`);
      
    } else {
      // Data only - keep users and structure
      console.log('Truncating transactional tables...');
      await pool.query(`
        TRUNCATE sales_transactions, user_contributions, batch_coins, payouts, coin_types, batches RESTART IDENTITY CASCADE
      `);
    }
    
    // Show remaining counts
    const counts = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM batches) as batches,
        (SELECT COUNT(*) FROM coin_types) as coin_types,
        (SELECT COUNT(*) FROM sales_transactions) as sales,
        (SELECT COUNT(*) FROM user_contributions) as contributions,
        (SELECT COUNT(*) FROM payouts) as payouts
    `);
    
    console.log('\n✅ Reset complete! Current counts:');
    console.log(`  Users: ${counts.rows[0].users}`);
    console.log(`  Batches: ${counts.rows[0].batches}`);
    console.log(`  Coin Types: ${counts.rows[0].coin_types}`);
    console.log(`  Sales: ${counts.rows[0].sales}`);
    console.log(`  Contributions: ${counts.rows[0].contributions}`);
    console.log(`  Payouts: ${counts.rows[0].payouts}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

resetDb();
