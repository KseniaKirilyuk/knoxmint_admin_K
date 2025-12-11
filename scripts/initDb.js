// Initialize the database schema
// Usage: DATABASE_URL="your-neon-url" node scripts/initDb.js

import pg from 'pg';

const schema = `
-- Drop tables if they exist
DROP TABLE IF EXISTS payout_items CASCADE;
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS sales_transactions CASCADE;
DROP TABLE IF EXISTS user_contributions CASCADE;
DROP TABLE IF EXISTS batch_coins CASCADE;
DROP TABLE IF EXISTS batches CASCADE;
DROP TABLE IF EXISTS coin_types CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- USERS TABLE
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    full_name VARCHAR(255),
    payment_info TEXT,
    role VARCHAR(20) DEFAULT 'user',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- COIN TYPES TABLE (master list of coin types)
CREATE TABLE coin_types (
    coin_type_id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL,
    short_code VARCHAR(20),
    mint_catalog_number VARCHAR(50),
    year INTEGER,
    description TEXT,
    keywords TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default coin types
INSERT INTO coin_types (name, short_code, keywords) VALUES
    ('Sacagawea', 'SAC', ARRAY['Sacagawea']),
    ('Laser Privy', 'LASER', ARRAY['Laser Privy', 'Laser']),
    ('Army Privy', 'ARMY', ARRAY['Army Privy', 'Army']),
    ('Liberty', 'LIB', ARRAY['Liberty', 'High Relief']),
    ('Navy Privy', 'NAVY', ARRAY['Navy Privy', 'Navy']),
    ('Morgan', 'MORG', ARRAY['Morgan']),
    ('Peace', 'PEACE', ARRAY['Peace']),
    ('American Eagle', 'AE', ARRAY['American Eagle', 'Silver Eagle']);

-- BATCHES TABLE (grader shipments)
CREATE TABLE batches (
    batch_id SERIAL PRIMARY KEY,
    batch_name VARCHAR(100) NOT NULL,
    ship_date DATE,
    grader VARCHAR(20),
    status VARCHAR(20) DEFAULT 'Active',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- BATCH COINS TABLE (coins in each batch with pricing)
CREATE TABLE batch_coins (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES batches(batch_id) ON DELETE CASCADE,
    coin_type_id INTEGER REFERENCES coin_types(coin_type_id),
    original_price DECIMAL(10, 2),
    current_price DECIMAL(10, 2),
    total_contributed INTEGER DEFAULT 0,
    total_sold INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(batch_id, coin_type_id)
);

-- USER CONTRIBUTIONS TABLE
CREATE TABLE user_contributions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    batch_id INTEGER REFERENCES batches(batch_id) ON DELETE CASCADE,
    coin_type_id INTEGER REFERENCES coin_types(coin_type_id),
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, batch_id, coin_type_id)
);

-- SALES TRANSACTIONS TABLE
CREATE TABLE sales_transactions (
    transaction_id SERIAL PRIMARY KEY,
    batch_id INTEGER REFERENCES batches(batch_id),
    coin_type_id INTEGER REFERENCES coin_types(coin_type_id),
    listing_id VARCHAR(50),
    order_number VARCHAR(50),
    item_title TEXT,
    sale_date DATE NOT NULL,
    sale_price DECIMAL(10, 2) NOT NULL,
    net_amount DECIMAL(10, 2),
    ebay_fee DECIMAL(10, 2) DEFAULT 0,
    quantity_sold INTEGER DEFAULT 1,
    profit DECIMAL(10, 2),
    profit_share DECIMAL(10, 2),
    is_paid_out BOOLEAN DEFAULT false,
    imported_from VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PAYOUTS TABLE
CREATE TABLE payouts (
    payout_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    batch_id INTEGER REFERENCES batches(batch_id),
    payout_date DATE NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending',
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PAYOUT ITEMS TABLE
CREATE TABLE payout_items (
    item_id SERIAL PRIMARY KEY,
    payout_id INTEGER REFERENCES payouts(payout_id),
    transaction_id INTEGER REFERENCES sales_transactions(transaction_id),
    coin_type_id INTEGER REFERENCES coin_types(coin_type_id),
    user_share_amount DECIMAL(10, 2) NOT NULL,
    user_share_percentage DECIMAL(10, 6) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES
CREATE INDEX idx_contributions_batch ON user_contributions(batch_id);
CREATE INDEX idx_contributions_user ON user_contributions(user_id);
CREATE INDEX idx_transactions_batch ON sales_transactions(batch_id);
CREATE INDEX idx_transactions_coin_type ON sales_transactions(coin_type_id);
CREATE INDEX idx_transactions_date ON sales_transactions(sale_date);
CREATE INDEX idx_batch_coins_batch ON batch_coins(batch_id);
CREATE INDEX idx_payouts_user ON payouts(user_id);
CREATE INDEX idx_payouts_status ON payouts(status);
`;

async function init() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔧 Initializing database...');
    await pool.query(schema);
    console.log('✅ Database schema created successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

init();
