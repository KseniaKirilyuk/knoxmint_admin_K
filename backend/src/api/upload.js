const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Group name to ID mapping
const GROUP_MAPPING = {
  'NGC FDI': 1,
  'NGC FR': 2,
  'PCGS RP FS': 3,
  'NGC RP FDI': 4,
  'PCGS PR FDI': 5,
  'PCGS FDI': 6
};

// Parse sale type
function parseSaleType(value) {
  if (!value) return 'Fixed';
  const v = String(value).toLowerCase();
  if (v.includes('auction')) return 'Auction';
  return 'Fixed';
}

// Parse date
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  
  // Excel serial date
  if (typeof value === 'number') {
    const date = new Date((value - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  
  // String date
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }
  
  return null;
}

// Parse number
function parseNumber(value) {
  if (value === null || value === undefined || value === '' || value === 'NaN') return 0;
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}

// Upload and preview Excel file
router.post('/preview', authenticate, requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.readFile(req.file.path);
    const preview = {};

    for (const sheetName of workbook.SheetNames) {
      // Skip the Payouts sheet for transaction import
      if (sheetName.toLowerCase() === 'payouts') continue;

      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      
      // Find header row (look for "Listing" or similar)
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        if (row && row.some(cell => String(cell).toLowerCase().includes('listing'))) {
          headerRowIndex = i;
          break;
        }
      }

      const headers = data[headerRowIndex] || [];
      const rows = data.slice(headerRowIndex + 1, headerRowIndex + 11); // Preview first 10 rows

      preview[sheetName] = {
        headers: headers.slice(0, 16), // First 16 columns (main data)
        rows: rows.map(row => row.slice(0, 16)),
        totalRows: data.length - headerRowIndex - 1,
        groupId: GROUP_MAPPING[sheetName] || null
      };
    }

    // Clean up uploaded file after preview
    // fs.unlinkSync(req.file.path);

    res.json({
      filename: req.file.originalname,
      filepath: req.file.path,
      sheets: preview
    });
  } catch (error) {
    console.error('Error previewing file:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Error processing file: ' + error.message });
  }
});

// Import transactions from Excel
router.post('/import', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filepath, selectedSheets } = req.body;

    if (!filepath || !fs.existsSync(filepath)) {
      return res.status(400).json({ error: 'File not found. Please upload again.' });
    }

    const workbook = XLSX.readFile(filepath);
    const results = {
      imported: 0,
      skipped: 0,
      errors: [],
      bySheet: {}
    };

    for (const sheetName of selectedSheets || workbook.SheetNames) {
      if (sheetName.toLowerCase() === 'payouts') continue;
      if (!workbook.SheetNames.includes(sheetName)) continue;

      const groupId = GROUP_MAPPING[sheetName];
      if (!groupId) {
        results.errors.push(`Unknown group: ${sheetName}`);
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // Find header row
      let headerRowIndex = 0;
      for (let i = 0; i < Math.min(5, data.length); i++) {
        const row = data[i];
        if (row && row.some(cell => String(cell).toLowerCase().includes('listing'))) {
          headerRowIndex = i;
          break;
        }
      }

      const headers = data[headerRowIndex] || [];
      const columnMap = {};
      headers.forEach((h, i) => {
        if (h) columnMap[String(h).toLowerCase().trim()] = i;
      });

      let sheetImported = 0;
      let sheetSkipped = 0;

      for (let i = headerRowIndex + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0]) continue; // Skip empty rows

        try {
          const listingId = String(row[columnMap['listing']] || '');
          if (!listingId || listingId === 'NaN') {
            sheetSkipped++;
            continue;
          }

          // Check for duplicate listing
          const existing = await db.query(
            'SELECT transaction_id FROM sales_transactions WHERE listing_id = $1 AND group_id = $2',
            [listingId, groupId]
          );

          if (existing.rows.length > 0) {
            sheetSkipped++;
            continue;
          }

          const saleDate = parseDate(row[columnMap['date sold']]);
          const salePrice = parseNumber(row[columnMap['price sold']]);
          
          if (!saleDate || salePrice === 0) {
            sheetSkipped++;
            continue;
          }

          const ebayFee = parseNumber(row[columnMap['net ebay fee']] || row[columnMap['ebay fee']]);
          const advertising = parseNumber(row[columnMap['advertising']]);
          const shipping = parseNumber(row[columnMap['shipping and packaging']] || row[columnMap['shipping cost']]);
          const totalPayout = parseNumber(row[columnMap['total payout']]);
          const coinCost = parseNumber(row[columnMap['coin cost']]);
          const profit = parseNumber(row[columnMap['profit']]);
          const profitShare = parseNumber(row[columnMap['profit share']]);
          const saleType = parseSaleType(row[columnMap['sale type']]);
          const quantity = parseNumber(row[columnMap['number of coins']] || row[columnMap['quantity sold']]) || 1;

          // Calculate if not provided
          const calculatedPayout = totalPayout || (salePrice - ebayFee - advertising - shipping);
          const calculatedProfit = profit || (calculatedPayout - coinCost);
          
          // Get group's profit share settings for calculation if not provided
          let calculatedProfitShare = profitShare;
          if (!calculatedProfitShare || calculatedProfitShare === 0) {
            const groupResult = await db.query(
              'SELECT profit_share_percentage, profit_share_minimum FROM groups WHERE group_id = $1',
              [groupId]
            );
            if (groupResult.rows.length > 0) {
              const g = groupResult.rows[0];
              calculatedProfitShare = Math.max(
                calculatedProfit * parseFloat(g.profit_share_percentage),
                parseFloat(g.profit_share_minimum)
              );
            }
          }

          await db.query(`
            INSERT INTO sales_transactions (
              group_id, listing_id, sale_date, sale_price,
              ebay_fee, advertising_fee, shipping_cost, total_payout,
              coin_cost, profit, profit_share, sale_type, quantity_sold,
              imported_from
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `, [
            groupId, listingId, saleDate, salePrice,
            ebayFee, advertising, shipping, calculatedPayout,
            coinCost, calculatedProfit, calculatedProfitShare, saleType, quantity,
            sheetName
          ]);

          sheetImported++;
          results.imported++;
        } catch (rowError) {
          results.errors.push(`Row ${i + 1} in ${sheetName}: ${rowError.message}`);
          sheetSkipped++;
        }
      }

      results.bySheet[sheetName] = {
        imported: sheetImported,
        skipped: sheetSkipped
      };
      results.skipped += sheetSkipped;
    }

    // Clean up file after import
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }

    res.json(results);
  } catch (error) {
    console.error('Error importing file:', error);
    res.status(500).json({ error: 'Error importing file: ' + error.message });
  }
});

// Import payouts from Excel
router.post('/import-payouts', authenticate, requireAdmin, async (req, res) => {
  try {
    const { filepath } = req.body;

    if (!filepath || !fs.existsSync(filepath)) {
      return res.status(400).json({ error: 'File not found. Please upload again.' });
    }

    const workbook = XLSX.readFile(filepath);
    const payoutsSheet = workbook.Sheets['Payouts'];

    if (!payoutsSheet) {
      return res.status(400).json({ error: 'Payouts sheet not found' });
    }

    const data = XLSX.utils.sheet_to_json(payoutsSheet, { header: 1 });
    const results = { imported: 0, skipped: 0, errors: [] };

    // First row is headers with dates
    const headers = data[0] || [];
    
    // Find date columns (columns after "Total Payout")
    const dateColumns = [];
    for (let i = 2; i < headers.length - 1; i++) {
      const header = headers[i];
      if (header && (header instanceof Date || !isNaN(Date.parse(header)))) {
        dateColumns.push({ index: i, date: parseDate(header) });
      }
    }

    // Process each user row
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const username = row[0];
      
      if (!username || username === 'NaN') continue;

      // Get user ID
      const userResult = await db.query(
        'SELECT user_id FROM users WHERE username = $1',
        [username]
      );

      if (userResult.rows.length === 0) {
        results.errors.push(`User not found: ${username}`);
        continue;
      }

      const userId = userResult.rows[0].user_id;

      // Process each date column
      for (const { index, date } of dateColumns) {
        const amount = parseNumber(row[index]);
        
        if (amount > 0 && date) {
          try {
            // Check if payout already exists
            const existing = await db.query(
              'SELECT payout_id FROM payouts WHERE user_id = $1 AND payout_date = $2',
              [userId, date]
            );

            if (existing.rows.length === 0) {
              // Determine group (simplified - you may want more complex logic)
              const groupResult = await db.query('SELECT group_id FROM groups LIMIT 1');
              const groupId = groupResult.rows[0]?.group_id || 1;

              await db.query(`
                INSERT INTO payouts (user_id, group_id, payout_date, amount, status)
                VALUES ($1, $2, $3, $4, 'Paid')
              `, [userId, groupId, date, amount]);

              results.imported++;
            } else {
              results.skipped++;
            }
          } catch (err) {
            results.errors.push(`${username} on ${date}: ${err.message}`);
          }
        }
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error importing payouts:', error);
    res.status(500).json({ error: 'Error importing payouts: ' + error.message });
  }
});

module.exports = router;
