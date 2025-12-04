# KnoxMint Admin Dashboard

A comprehensive admin dashboard for managing US Mint coin sales, payout tracking, and profit distribution among group members.

## 🪙 Overview

KnoxMint Admin Dashboard helps manage:
- **Sales Transactions** - Track eBay sales of graded Morgan & Peace dollars
- **Group Management** - Organize coins into selling groups (NGC FDI, PCGS FR, etc.)
- **User Contributions** - Track member ownership and profit shares
- **Payout Tracking** - Calculate and record payouts to group members
- **Excel Import** - Bulk import sales data from Excel spreadsheets

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+ (or use SQLite for development)
- npm or yarn

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/mlweiss/knoxmint_admin_dashboard.git
cd knoxmint_admin_dashboard
```

2. **Set up the backend**
```bash
cd backend
cp .env.example .env
# Edit .env with your database credentials
npm install
```

3. **Initialize the database**
```bash
# Make sure PostgreSQL is running
npm run db:init
npm run db:seed  # Optional: adds sample data
```

4. **Set up the frontend**
```bash
cd ../frontend
npm install
```

5. **Start development servers**

In one terminal (backend):
```bash
cd backend
npm run dev
```

In another terminal (frontend):
```bash
cd frontend
npm run dev
```

6. **Open the app**
Navigate to http://localhost:3000

**Default login:**
- Username: `admin`
- Password: `admin123`

## 📁 Project Structure

```
knoxmint_admin_dashboard/
├── backend/
│   ├── src/
│   │   ├── api/          # Express route handlers
│   │   ├── config/       # Database configuration
│   │   ├── middleware/   # Auth middleware
│   │   └── utils/        # DB scripts
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Page components
│   │   ├── hooks/        # Custom hooks
│   │   ├── lib/          # Utilities
│   │   └── styles/       # CSS
│   ├── package.json
│   └── vite.config.js
├── database/
│   └── schema.sql        # Full database schema
└── README.md
```

## 🗄️ Database Schema

### Core Tables
- **users** - Group members and admins
- **groups** - Selling groups (NGC FDI, PCGS FR, etc.)
- **mint_products** - US Mint product reference
- **graded_coins** - Inventory with grades and costs
- **sales_transactions** - Individual sales records
- **user_contributions** - User ownership per group
- **payouts** - Payment tracking

### Key Relationships
- Users belong to multiple groups via `user_contributions`
- Sales are linked to groups and optionally to specific graded coins
- Payouts track payments to users per group

## 💰 Profit Share Calculation

Each group has configurable profit share settings:
- **Percentage** (default: 33%) - Base percentage of profit
- **Minimum** (default: $8.00) - Floor for profit share
- **Maximum** (optional) - Cap for profit share

```
profit_share = profit × percentage
profit_share = max(profit_share, minimum)
if maximum: profit_share = min(profit_share, maximum)
```

## 📊 Features

### Phase 1 (Current)
- ✅ Excel file import for sales transactions
- ✅ Sales dashboard with filtering and pagination
- ✅ Payout tracking and management
- ✅ User and group management
- ✅ Profit share calculations
- ✅ Data visualization with charts

### Phase 2 (Planned)
- ⏳ eBay API integration for automatic sales sync
- ⏳ Automated daily transaction imports
- ⏳ Real-time fee calculations
- ⏳ Enhanced reporting

## 🔧 Configuration

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/knoxmint

# Server
PORT=3001
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# eBay API (Phase 2)
EBAY_APP_ID=
EBAY_DEV_ID=
EBAY_CERT_ID=
```

## 📝 Excel Import Format

The import feature expects Excel files with sheets named after groups:
- `NGC FDI`, `NGC FR`, `PCGS RP FS`, etc.

Required columns:
- `Listing` - eBay listing ID
- `Date Sold` - Sale date
- `Price Sold` - Sale price
- `Net eBay Fee` - eBay fees
- `Advertising` - Ad fees
- `Shipping and Packaging` - Shipping costs
- `Total Payout` - Net payout
- `Coin Cost` - Cost basis
- `Profit` - Calculated profit
- `Profit Share` - Member share

## 🛠️ Tech Stack

- **Frontend**: React 18, Tailwind CSS, Recharts, React Router
- **Backend**: Node.js, Express
- **Database**: PostgreSQL
- **Build**: Vite

## 📄 License

Private - All rights reserved.

## 🤝 Support

For questions or issues, contact the development team.
