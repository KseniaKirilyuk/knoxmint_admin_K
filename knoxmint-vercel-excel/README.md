# KnoxMint Admin Dashboard

Admin dashboard for US Mint coin sales, deployed on Vercel with Neon Postgres.

## 🚀 Deploy to Vercel + Neon

### Step 1: Push to GitHub

```bash
# Replace your repo files with this version
git add .
git commit -m "Restructure for Vercel + Neon deployment"
git push origin main
```

### Step 2: Create Neon Database

1. In Vercel, go to your project → **Storage** tab
2. Click **"Create"** next to **Neon** (Serverless Postgres)
3. Name it `knoxmint-db` → Follow the prompts
4. Neon automatically adds `DATABASE_URL` to your environment variables

**Or create directly at [neon.tech](https://neon.tech):**
1. Sign up / Log in
2. Create a new project
3. Copy the connection string
4. Add it to Vercel: Settings → Environment Variables → `DATABASE_URL`

### Step 3: Add JWT Secret

1. Go to Vercel **Settings** → **Environment Variables**
2. Add:
   - Name: `JWT_SECRET`
   - Value: `knoxmint-secret-2024` (or any random string)
3. Click **Save**

### Step 4: Initialize Database

Run these commands locally:

```bash
# Install dependencies first
npm install

# Get your DATABASE_URL from:
# - Vercel → Storage → your database → Connection string
# - Or Neon dashboard → Connection Details

# Initialize schema
DATABASE_URL="postgres://..." node scripts/initDb.js

# Add sample data
DATABASE_URL="postgres://..." node scripts/seedDb.js
```

### Step 5: Deploy

1. Go to **Deployments** tab in Vercel
2. Click **"Redeploy"** on the latest deployment

### Done! 🎉

Your app is live at `https://your-project.vercel.app`

**Login:**
- Username: `admin`
- Password: `admin123`

---

## Project Structure

```
knoxmint-vercel/
├── api/                    # Vercel Serverless Functions
│   ├── _lib/
│   │   └── db.js          # Database connection
│   ├── auth/
│   ├── dashboard/
│   ├── groups/
│   ├── payouts/
│   ├── transactions/
│   └── users/
├── src/                    # React frontend
├── scripts/                # Database setup
│   ├── initDb.js
│   └── seedDb.js
├── vercel.json
└── package.json
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon Postgres connection string |
| `JWT_SECRET` | Secret key for JWT tokens |

## Local Development

```bash
# Install Vercel CLI
npm i -g vercel

# Link to your project
vercel link

# Pull environment variables
vercel env pull .env.local

# Run locally
vercel dev
```

## Tech Stack

- **Frontend**: React + Tailwind CSS + Vite
- **Backend**: Vercel Serverless Functions
- **Database**: Neon Postgres
- **Auth**: JWT
