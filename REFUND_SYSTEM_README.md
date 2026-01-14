# Refund Alert System - Deployment Guide

## Overview

This update adds a comprehensive refund handling system that:
1. Automatically detects and categorizes refunds during import
2. Creates alerts for admin review
3. Calculates proportional recovery from members for paid batches
4. Provides UI to manage and resolve refund alerts

## Files to Deploy

### 1. Database Migration (Run First!)
```sql
-- Run in Neon SQL Console
-- File: migrations/add_refund_tables.sql
```

### 2. API Files
```
api/upload/index.js      → Updated refund handling
api/refunds/index.js     → NEW - Refund alerts API
api/batches/index.js     → Added memberAdjustments action
```

### 3. Frontend Components
```
src/pages/RefundAlerts.jsx    → NEW - Refund alerts page
src/components/RefundAlertBadge.jsx → NEW - Badge for sidebar
```

## Deployment Steps

### Step 1: Run Database Migration
Open Neon SQL Console and run the contents of `migrations/add_refund_tables.sql`

### Step 2: Deploy Backend Files
```bash
cd knoxmint_admin_dashboard

# Copy API files
cp ~/Downloads/upload_index.js api/upload/index.js
mkdir -p api/refunds
cp ~/Downloads/refunds_index.js api/refunds/index.js
cp ~/Downloads/batches_index.js api/batches/index.js

# Add route to vercel.json if needed
```

### Step 3: Deploy Frontend Files
```bash
# Copy page components
cp ~/Downloads/RefundAlerts.jsx src/pages/RefundAlerts.jsx
cp ~/Downloads/RefundAlertBadge.jsx src/components/RefundAlertBadge.jsx
```

### Step 4: Add Route to App.jsx
```jsx
import RefundAlerts from './pages/RefundAlerts'

// In your Routes:
<Route path="/refunds" element={<RefundAlerts />} />
```

### Step 5: Add to Sidebar/Navigation
```jsx
import RefundAlertBadge from '../components/RefundAlertBadge'
import { AlertTriangle } from 'lucide-react'

// In your sidebar nav items:
<NavLink to="/refunds" className="nav-link flex items-center">
  <AlertTriangle className="w-5 h-5 mr-3" />
  Refund Alerts
  <RefundAlertBadge />
</NavLink>
```

### Step 6: Push Changes
```bash
git add .
git commit -m "Add refund alert system with member adjustments"
git push origin main
```

## How It Works

### On Import (Upload)
When a refund is detected:
1. Checks if original sale exists
2. Determines alert type:
   - `orphan` - No original sale found
   - `unmapped` - Original found but no batch
   - `unpaid_batch` - Original in batch, not paid yet
   - `paid_batch` - Original in batch, already paid
3. Creates refund alert
4. For batches: decreases `batch_coins.total_sold`
5. For paid batches: creates `member_adjustments` records

### Admin Actions
- **Unpaid Batch**: Assign another sale to replace refund, or wait for resale
- **Paid Batch**: Apply adjustments to member balances (deduct from next payout)
- **Orphan/Unmapped**: Review and dismiss

### Member Adjustments
Get pending adjustments for a user:
```
GET /batches?action=memberAdjustments&userId=123&status=pending
```

Response includes:
- List of adjustments
- Summary with totals per user

## Alert Types Reference

| Type | Priority | Description |
|------|----------|-------------|
| `paid_batch` | HIGH | Refund on paid batch - recovery needed |
| `orphan` | HIGH | No original sale found - manual review |
| `unpaid_batch` | MEDIUM | Batch inventory adjusted, suggest replacement |
| `unmapped` | LOW | Sale wasn't in a batch anyway |

## API Endpoints

### Refund Alerts
- `GET /refunds?status=pending` - List alerts
- `GET /refunds?action=count` - Get pending count (for badge)
- `GET /refunds?action=details&alertId=X` - Get alert details
- `PUT /refunds?alertId=X` - Update status or assign sale
- `POST /refunds` - Apply/waive adjustments

### Member Adjustments
- `GET /batches?action=memberAdjustments` - Get all adjustments
- `GET /batches?action=memberAdjustments&userId=X` - Get for specific user
