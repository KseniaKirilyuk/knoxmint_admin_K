// Run this script locally to initialize your Vercel Postgres database
// Usage: POSTGRES_URL="your-vercel-postgres-url" node scripts/initDb.js

import { sql } from '@vercel/postgres';

const schema = `
-- Drop tables if they exist
DROP TABLE IF EXISTS payout_items CASCADE;
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS sales_transactions CASCADE;
DROP TABLE IF EXISTS user_contributions CASCADE;
DROP TABLE IF EXISTS group_inventory CASCADE;
DROP TABLE IF EXISTS groups CASCADE;
DROP TABLE IF EXISTS graded_coins CASCADE;
DROP TABLE IF EXISTS grading_batches CASCADE;
DROP TABLE IF EXISTS purchases CASCADE;
DROP TABLE IF EXISTS mint_products CASCADE;
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

-- MINT PRODUCTS TABLE
CREATE TABLE mint_products (
    product_id SERIAL PRIMARY KEY,
    year INTEGER NOT NULL,
    design VARCHAR(50) NOT NULL,
    finish VARCHAR(50) NOT NULL,
    mint_catalog_number VARCHAR(20),
    metal_type VARCHAR(20) DEFAULT 'Silver',
    weight_oz DECIMAL(10, 4) DEFAULT 1.0,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GRADING BATCHES TABLE
CREATE TABLE grading_batches (
    batch_id SERIAL PRIMARY KEY,
    grader VARCHAR(20) NOT NULL,
    submission_date DATE,
    return_date DATE,
    total_grading_cost DECIMAL(12, 2),
    coins_submitted INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GRADED COINS TABLE
CREATE TABLE graded_coins (
    graded_coin_id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES mint_products(product_id),
    batch_id INTEGER REFERENCES grading_batches(batch_id),
    grader VARCHAR(20) NOT NULL,
    grade VARCHAR(10),
    label_type VARCHAR(20),
    quantity INTEGER NOT NULL DEFAULT 0,
    raw_cost_per_coin DECIMAL(10, 2),
    grading_cost_per_coin DECIMAL(10, 2),
    total_cost_per_coin DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GROUPS TABLE
CREATE TABLE groups (
    group_id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) UNIQUE NOT NULL,
    grader VARCHAR(20),
    label_type VARCHAR(20),
    status VARCHAR(20) DEFAULT 'Active',
    profit_share_percentage DECIMAL(5, 4) DEFAULT 0.33,
    profit_share_minimum DECIMAL(10, 2) DEFAULT 8.00,
    profit_share_maximum DECIMAL(10, 2),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GROUP INVENTORY TABLE
CREATE TABLE group_inventory (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(group_id),
    graded_coin_id INTEGER REFERENCES graded_coins(graded_coin_id),
    quantity INTEGER NOT NULL DEFAULT 0,
    cost_per_coin DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, graded_coin_id)
);

-- USER CONTRIBUTIONS TABLE
CREATE TABLE user_contributions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    group_id INTEGER REFERENCES groups(group_id),
    graded_coin_id INTEGER REFERENCES graded_coins(graded_coin_id),
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, group_id, graded_coin_id)
);

-- SALES TRANSACTIONS TABLE
CREATE TABLE sales_transactions (
    transaction_id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(group_id),
    graded_coin_id INTEGER REFERENCES graded_coins(graded_coin_id),
    listing_id VARCHAR(50),
    sale_date DATE NOT NULL,
    sale_price DECIMAL(10, 2) NOT NULL,
    ebay_fee DECIMAL(10, 2) DEFAULT 0,
    advertising_fee DECIMAL(10, 2) DEFAULT 0,
    shipping_cost DECIMAL(10, 2) DEFAULT 0,
    total_payout DECIMAL(10, 2) NOT NULL,
    coin_cost DECIMAL(10, 2) NOT NULL,
    profit DECIMAL(10, 2) NOT NULL,
    profit_share DECIMAL(10, 2) NOT NULL,
    sale_type VARCHAR(20),
    quantity_sold INTEGER DEFAULT 1,
    buyer_username VARCHAR(100),
    notes TEXT,
    imported_from VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PAYOUTS TABLE
CREATE TABLE payouts (
    payout_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    group_id INTEGER REFERENCES groups(group_id),
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
    user_share_amount DECIMAL(10, 2) NOT NULL,
    user_share_percentage DECIMAL(10, 6) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES
CREATE INDEX idx_transactions_group ON sales_transactions(group_id);
CREATE INDEX idx_transactions_date ON sales_transactions(sale_date);
CREATE INDEX idx_contributions_user ON user_contributions(user_id);
CREATE INDEX idx_payouts_user ON payouts(user_id);
CREATE INDEX idx_payouts_status ON payouts(status);
`;

async function init() {
  try {
    console.log('🔧 Initializing database...');
    await sql.query(schema);
    console.log('✅ Database schema created successfully!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

init();
