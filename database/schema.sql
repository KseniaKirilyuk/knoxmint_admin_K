-- KnoxMint Admin Dashboard Database Schema
-- Version 1.0.0

-- Drop tables if they exist (for clean setup)
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

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    full_name VARCHAR(255),
    payment_info TEXT,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- MINT PRODUCTS TABLE (US Mint Reference)
-- ============================================
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

-- ============================================
-- PURCHASES TABLE (Raw coin buys)
-- ============================================
CREATE TABLE purchases (
    purchase_id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES mint_products(product_id),
    purchase_date DATE NOT NULL,
    quantity INTEGER NOT NULL,
    unit_cost DECIMAL(10, 2) NOT NULL,
    total_cost DECIMAL(12, 2) NOT NULL,
    source VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- GRADING BATCHES TABLE (Coins graded together)
-- ============================================
CREATE TABLE grading_batches (
    batch_id SERIAL PRIMARY KEY,
    grader VARCHAR(20) NOT NULL CHECK (grader IN ('NGC', 'PCGS', 'Ungraded')),
    submission_date DATE,
    return_date DATE,
    total_grading_cost DECIMAL(12, 2),
    coins_submitted INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- GRADED COINS TABLE (Inventory)
-- ============================================
CREATE TABLE graded_coins (
    graded_coin_id SERIAL PRIMARY KEY,
    product_id INTEGER REFERENCES mint_products(product_id),
    batch_id INTEGER REFERENCES grading_batches(batch_id),
    grader VARCHAR(20) NOT NULL CHECK (grader IN ('NGC', 'PCGS', 'Ungraded')),
    grade VARCHAR(10),
    label_type VARCHAR(20) CHECK (label_type IN ('FDI', 'FR', 'FS', 'RP', 'PR', NULL)),
    quantity INTEGER NOT NULL DEFAULT 0,
    raw_cost_per_coin DECIMAL(10, 2),
    grading_cost_per_coin DECIMAL(10, 2),
    total_cost_per_coin DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- GROUPS TABLE (Selling groups)
-- ============================================
CREATE TABLE groups (
    group_id SERIAL PRIMARY KEY,
    group_name VARCHAR(100) UNIQUE NOT NULL,
    grader VARCHAR(20) CHECK (grader IN ('NGC', 'PCGS', 'Ungraded', NULL)),
    label_type VARCHAR(20) CHECK (label_type IN ('FDI', 'FR', 'FS', 'RP', 'PR', NULL)),
    status VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active', 'Closed', 'Pending')),
    profit_share_percentage DECIMAL(5, 4) DEFAULT 0.33,
    profit_share_minimum DECIMAL(10, 2) DEFAULT 8.00,
    profit_share_maximum DECIMAL(10, 2),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- GROUP INVENTORY TABLE (Coins in each group)
-- ============================================
CREATE TABLE group_inventory (
    id SERIAL PRIMARY KEY,
    group_id INTEGER REFERENCES groups(group_id),
    graded_coin_id INTEGER REFERENCES graded_coins(graded_coin_id),
    quantity INTEGER NOT NULL DEFAULT 0,
    cost_per_coin DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, graded_coin_id)
);

-- ============================================
-- USER CONTRIBUTIONS TABLE (User ownership per group)
-- ============================================
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

-- ============================================
-- SALES TRANSACTIONS TABLE
-- ============================================
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
    sale_type VARCHAR(20) CHECK (sale_type IN ('Auction', 'Fixed', 'Fixed Price')),
    quantity_sold INTEGER DEFAULT 1,
    buyer_username VARCHAR(100),
    notes TEXT,
    imported_from VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PAYOUTS TABLE (Payment tracking)
-- ============================================
CREATE TABLE payouts (
    payout_id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(user_id),
    group_id INTEGER REFERENCES groups(group_id),
    payout_date DATE NOT NULL,
    amount DECIMAL(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Paid', 'Cancelled')),
    payment_method VARCHAR(50),
    payment_reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- PAYOUT ITEMS TABLE (Individual transactions in a payout)
-- ============================================
CREATE TABLE payout_items (
    item_id SERIAL PRIMARY KEY,
    payout_id INTEGER REFERENCES payouts(payout_id),
    transaction_id INTEGER REFERENCES sales_transactions(transaction_id),
    user_share_amount DECIMAL(10, 2) NOT NULL,
    user_share_percentage DECIMAL(10, 6) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_transactions_group ON sales_transactions(group_id);
CREATE INDEX idx_transactions_date ON sales_transactions(sale_date);
CREATE INDEX idx_contributions_user ON user_contributions(user_id);
CREATE INDEX idx_contributions_group ON user_contributions(group_id);
CREATE INDEX idx_payouts_user ON payouts(user_id);
CREATE INDEX idx_payouts_status ON payouts(status);
CREATE INDEX idx_graded_coins_grader ON graded_coins(grader);

-- ============================================
-- VIEWS FOR REPORTING
-- ============================================

-- User payout summary view
CREATE OR REPLACE VIEW user_payout_summary AS
SELECT 
    u.user_id,
    u.username,
    u.full_name,
    g.group_id,
    g.group_name,
    COALESCE(SUM(CASE WHEN p.status = 'Paid' THEN p.amount ELSE 0 END), 0) as total_paid,
    COALESCE(SUM(CASE WHEN p.status = 'Pending' THEN p.amount ELSE 0 END), 0) as total_pending
FROM users u
CROSS JOIN groups g
LEFT JOIN payouts p ON u.user_id = p.user_id AND g.group_id = p.group_id
GROUP BY u.user_id, u.username, u.full_name, g.group_id, g.group_name;

-- Group sales summary view
CREATE OR REPLACE VIEW group_sales_summary AS
SELECT 
    g.group_id,
    g.group_name,
    COUNT(st.transaction_id) as total_sales,
    COALESCE(SUM(st.sale_price), 0) as total_revenue,
    COALESCE(SUM(st.profit), 0) as total_profit,
    COALESCE(SUM(st.profit_share), 0) as total_profit_share,
    MIN(st.sale_date) as first_sale_date,
    MAX(st.sale_date) as last_sale_date
FROM groups g
LEFT JOIN sales_transactions st ON g.group_id = st.group_id
GROUP BY g.group_id, g.group_name;

-- ============================================
-- TRIGGER: Update timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_contributions_updated_at BEFORE UPDATE ON user_contributions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payouts_updated_at BEFORE UPDATE ON payouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_graded_coins_updated_at BEFORE UPDATE ON graded_coins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
