-- Migration: Add refund alerts and member adjustments tables
-- Run this in your Neon SQL console

-- Refund alerts for admin review
CREATE TABLE IF NOT EXISTS refund_alerts (
  alert_id SERIAL PRIMARY KEY,
  refund_transaction_id INTEGER REFERENCES sales_transactions(transaction_id) ON DELETE CASCADE,
  original_transaction_id INTEGER REFERENCES sales_transactions(transaction_id) ON DELETE SET NULL,
  batch_id INTEGER REFERENCES batches(batch_id) ON DELETE SET NULL,
  coin_type_id INTEGER REFERENCES coin_types(coin_type_id) ON DELETE SET NULL,
  order_number VARCHAR(50),
  refund_amount DECIMAL(10,2),
  alert_type VARCHAR(20) NOT NULL, -- 'orphan', 'unmapped', 'unpaid_batch', 'paid_batch'
  batch_was_paid BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'resolved', 'dismissed'
  suggestion TEXT,
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP,
  resolved_by INTEGER REFERENCES users(user_id)
);

-- Member adjustments for paid batch recovery
CREATE TABLE IF NOT EXISTS member_adjustments (
  adjustment_id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  alert_id INTEGER REFERENCES refund_alerts(alert_id) ON DELETE CASCADE,
  batch_id INTEGER REFERENCES batches(batch_id) ON DELETE SET NULL,
  coin_type_id INTEGER REFERENCES coin_types(coin_type_id) ON DELETE SET NULL,
  amount DECIMAL(10,2) NOT NULL, -- negative for owed
  share_percent DECIMAL(5,2), -- member's % share of batch
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'applied', 'waived'
  applied_to_payout_id INTEGER REFERENCES payouts(payout_id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  applied_at TIMESTAMP
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_refund_alerts_status ON refund_alerts(status);
CREATE INDEX IF NOT EXISTS idx_refund_alerts_batch ON refund_alerts(batch_id);
CREATE INDEX IF NOT EXISTS idx_member_adjustments_user ON member_adjustments(user_id);
CREATE INDEX IF NOT EXISTS idx_member_adjustments_status ON member_adjustments(status);

-- Verify tables created
SELECT 'refund_alerts' as table_name, COUNT(*) as rows FROM refund_alerts
UNION ALL
SELECT 'member_adjustments', COUNT(*) FROM member_adjustments;
