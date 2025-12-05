# KnoxMint Admin Dashboard (Vercel Edition)

Admin dashboard for US Mint coin sales, deployed entirely on Vercel.

## 🚀 Deploy to Vercel

### Step 1: Push to GitHub

```bash
# In your knoxmint_admin_dashboard repo, replace all files with this version
git add .
git commit -m "Restructure for Vercel deployment"
git push origin main
```

### Step 2: Create Vercel Project

1. Go to [vercel.com](https://vercel.com) and sign in with GitHub
2. Click **"Add New Project"**
3. Select your `knoxmint_admin_dashboard` repository
4. Click **"Deploy"** (it will fail - that's OK, we need to add the database)

### Step 3: Add Vercel Postgres

1. In your Vercel project, go to **Storage** tab
2. Click **"Create Database"** → Select **"Postgres"**
3. Name it `knoxmint-db` and click **"Create"**
4. Vercel automatically adds the `POSTGRES_URL` environment variable

### Step 4: Add JWT Secret

1. Go to **Settings** → **Environment Variables**
2. Add:
   - Name: `JWT_SECRET`
   - Value: (any random string, like `knoxmint-secret-key-2024`)
3. Click **"Save"**

### Step 5: Initialize Database

Run these commands locally with your Vercel Postgres URL:

```bash
# Get your POSTGRES_URL from Vercel dashboard → Storage → your database → .env.local tab

# Install dependencies
npm install

# Initialize and seed the database
POSTGRES_URL="postgres://..." node scripts/initDb.js
POSTGRES_URL="postgres://..." node scripts/seedDb.js
```

### Step 6: Redeploy

1. Go to **Deployments** tab in Vercel
2. Click the **"..."** menu on the latest deployment
3. Click **"Redeploy"**

### Done! 🎉

Your app should now be live at `https://your-project.vercel.app`

**Login:**
- Username: `admin`
- Password: `admin123`

---

## Project Structure

```
knoxmint-vercel/
├── api/                    # Vercel Serverless Functions
│   ├── auth/
│   │   ├── login.js
│   │   └── me.js
│   ├── dashboard/
│   │   ├── stats.js
│   │   ├── sales-by-group.js
│   │   ├── sales-over-time.js
│   │   └── recent-transactions.js
│   ├── groups/
│   ├── payouts/
│   ├── transactions/
│   ├── users/
│   └── health.js
├── src/                    # React frontend
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   └── lib/
├── scripts/                # Database setup scripts
│   ├── initDb.js
│   └── seedDb.js
├── vercel.json
└── package.json
```

## Environment Variables (Vercel)

| Variable | Description |
|----------|-------------|
| `POSTGRES_URL` | Auto-added by Vercel Postgres |
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

---

## Tech Stack

- **Frontend**: React + Tailwind CSS + Vite
- **Backend**: Vercel Serverless Functions
- **Database**: Vercel Postgres
- **Auth**: JWT tokens
