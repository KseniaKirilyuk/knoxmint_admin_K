# KnoxMint API Map

Quick reference for finding code by user action.

## Batch Assignment Logic

**Single source of truth:** `api/_lib/batchAssignment.js`

All batch assignment code should use the shared utility to prevent bugs.

---

## API Endpoints by User Action

| User Action | File | Function/Section |
|-------------|------|------------------|
| **Upload Page** | | |
| Upload eBay file | `api/upload/index.js` | POST handler, line ~220 |
| "Reassign Batches" button | `api/upload/index.js` | `action === 'reassignBatches'`, line ~46 |
| | | |
| **Sales Page** | | |
| View transactions | `api/transactions/index.js` | GET handler |
| Map unmapped coins to type | `api/transactions/index.js` | PUT bulk mappings, line ~314 |
| Edit single transaction | `api/transactions/index.js` | PUT with transactionId |
| Delete transaction | `api/transactions/index.js` | DELETE handler |
| | | |
| **Batches Page** | | |
| Create batch | `api/batches/index.js` | POST `action: 'create'` |
| Edit batch | `api/batches/index.js` | PUT handler |
| Delete batch | `api/batches/index.js` | DELETE handler |
| Get batch details | `api/batches/index.js` | GET `action: 'details'` |
| Get coin types | `api/batches/index.js` | GET `action: 'coinTypes'` |
| | | |
| **Payouts Page** | | |
| Get payouts summary | `api/payouts/index.js` | GET handler |
| Get owed payouts | `api/payouts/owed.js` | GET handler |
| Mark as paid | `api/payouts/index.js` | PUT handler |
| | | |
| **Refunds** | | |
| Get refund alerts | `api/refunds/index.js` | GET handler |
| Resolve refund | `api/refunds/index.js` | PUT handler |

---

## File Structure

```
api/
├── _lib/
│   ├── db.js              # Database connection
│   ├── auth.js            # JWT authentication
│   └── batchAssignment.js # Shared batch logic ⭐
├── auth/
│   ├── login.js
│   └── me.js
├── batches/
│   └── index.js           # Batch CRUD + coin types
├── dashboard/
│   ├── stats.js
│   ├── sales-over-time.js
│   └── recent-transactions.js
├── payouts/
│   ├── index.js           # Payout calculations
│   └── owed.js            # Owed payouts
├── refunds/
│   └── index.js           # Refund alerts system
├── transactions/
│   └── index.js           # Sales CRUD + bulk mapping
├── upload/
│   └── index.js           # eBay import + reassign
└── users/
    └── index.js           # User management
```

---

## Key Business Logic

### Batch Assignment (FIFO)
1. Order batches by `ship_date ASC` (oldest first)
2. Check available inventory: `total_contributed - total_sold`
3. Track assignments during operation to prevent over-assignment
4. If no inventory → `batch_id = NULL` (unmapped)

### Payout Calculation
```
profit = total_payout - grading_cost - coin_cost
profit_share = MAX(0.33 × profit, $8 × quantity)
member_payout = total_payout - grading_cost - profit_share
```

### Refund Handling
- Refund rows have `is_refund = true`
- Original sale marked `is_refunded = true`
- Fees on refunds are positive (returned to seller)
