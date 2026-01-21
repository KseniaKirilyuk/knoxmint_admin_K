/**
 * Shared batch assignment logic - Single source of truth
 * Used by: upload/index.js, transactions/index.js
 * 
 * FIFO Logic:
 * 1. Order batches by date (oldest first)
 * 2. Assign to oldest batch with available inventory
 * 3. If no batch has inventory → return null (stays unmapped)
 */

/**
 * Find a batch with available inventory for a coin type
 * @param {number} coinTypeId - The coin type to find a batch for
 * @param {number} quantity - Number of coins to assign
 * @param {Object} assignedTracker - Object tracking assignments during current operation
 * @param {Function} query - Database query function
 * @returns {Object|null} - Batch info with costs, or null if no inventory
 */
export async function findAvailableBatch(coinTypeId, quantity, assignedTracker, query) {
  // Get all batches with this coin type (FIFO order)
  const batches = await query(`
    SELECT bc.batch_id, bc.cost_per_coin, bc.grading_cost_per_coin, 
           bc.total_contributed, bc.total_sold
    FROM batch_coins bc
    JOIN batches b ON bc.batch_id = b.batch_id
    WHERE bc.coin_type_id = $1 
      AND bc.cost_per_coin IS NOT NULL
    ORDER BY b.ship_date ASC NULLS LAST, b.created_at ASC
  `, [coinTypeId]);
  
  // Find first batch with available inventory
  for (const bc of batches.rows) {
    const key = `${bc.batch_id}-${coinTypeId}`;
    const alreadyAssigned = assignedTracker[key] || 0;
    const totalSold = parseInt(bc.total_sold) + alreadyAssigned;
    const available = parseInt(bc.total_contributed) - totalSold;
    
    if (available >= quantity) {
      // Track this assignment
      assignedTracker[key] = alreadyAssigned + quantity;
      
      return {
        batchId: bc.batch_id,
        coinCost: parseFloat(bc.cost_per_coin) || 0,
        gradingCost: parseFloat(bc.grading_cost_per_coin) || 0
      };
    }
  }
  
  return null; // No batch with available inventory
}

/**
 * Calculate payout values for a sale
 * @param {number} totalPayout - eBay payout amount
 * @param {number} salePrice - Original sale price
 * @param {number} quantity - Number of coins
 * @param {number} coinCost - Cost per coin
 * @param {number} gradingCost - Grading cost per coin
 * @returns {Object} - Calculated values
 */
export function calculatePayoutValues(totalPayout, salePrice, quantity, coinCost, gradingCost) {
  const totalCoinCost = coinCost * quantity;
  const totalGradingCost = gradingCost * quantity;
  const profit = totalPayout - totalGradingCost - totalCoinCost;
  const profitShare = Math.max(0.33 * profit, 8 * quantity);
  const payout = Math.max(0, totalPayout - totalGradingCost - profitShare);
  const profitMargin = salePrice > 0 ? profit / salePrice : 0;
  
  return {
    totalCoinCost,
    totalGradingCost,
    profit,
    profitShare,
    payout,
    profitMargin
  };
}

/**
 * Update batch_coins sold counts after assignments
 * @param {Function} query - Database query function
 */
export async function updateBatchSoldCounts(query) {
  await query(`
    UPDATE batch_coins bc
    SET total_sold = (
      SELECT COALESCE(SUM(st.quantity_sold), 0)
      FROM sales_transactions st
      WHERE st.batch_id = bc.batch_id
        AND st.coin_type_id = bc.coin_type_id
        AND COALESCE(st.is_refund, false) = false
        AND COALESCE(st.is_refunded, false) = false
    )
  `);
}
