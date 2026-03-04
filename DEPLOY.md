# FlightWatch — Deployment Guide

## What you have
- `server.js` — the backend (polls FlightAware, sends SMS, tracks budget)
- `src/App.jsx` — the frontend (iPhone-friendly web app)
- `.env` — your secret keys (never share this file)

---

## Step 1: Install Node.js on your computer

1. Go to https://nodejs.org
2. Download the "LTS" version (the recommended one)
3. Install it (just click through the installer)
4. Open Terminal (Mac) or Command Prompt (Windows)
5. Type `node --version` — you should see something like `v20.0.0`

---

## Step 2: Run the backend locally (test it first)

1. Open Terminal and navigate to the flightwatch folder:
   ```
   cd path/to/flightwatch
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Start the server:
   ```
   npm start
   ```
4. You should see: `FlightWatch server running on port 3001`
5. Open your browser and go to: http://localhost:3001/health
   - You should see: `{"status":"ok","apiCallCount":0,"activeWatches":0}`

---

## Step 3: Test a real flight lookup

In your browser, go to:
```
http://localhost:3001/api/flight/AC123?date=2024-03-15
```
(Replace AC123 with a real flight number and today's date)

---

## Step 4: Deploy to Railway (so it runs 24/7)

1. Go to https://railway.app and sign up with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Upload your flightwatch folder, OR use their CLI:
   ```
   npm install -g @railway/cli
   railway login
   railway init
   railway up
   ```
4. In Railway dashboard, go to your project → Variables tab
5. Add these environment variables (this keeps your keys safe):
   ```
   FLIGHTAWARE_API_KEY = your_key_here
   TWILIO_SID = (add when ready)
   TWILIO_TOKEN = (add when ready)
   TWILIO_FROM = (add when ready)
   PORT = 3001
   ```
6. Railway gives you a URL like `https://flightwatch-production.up.railway.app`
7. Update `API_BASE` in `src/App.jsx` to that URL

---

## Step 5: Add Twilio for SMS

1. Go to https://twilio.com → sign up free
2. Verify your phone number
3. Get your:
   - Account SID (starts with AC...)
   - Auth Token
   - A free Twilio phone number
4. Add them to Railway's Variables tab
5. The app will now send real SMS alerts!

---

## Budget protection

The server has a hard limit of **2,000 API calls** (~$20):
- At 1,500 calls (~$15): you get a console warning
- At 2,000 calls (~$20): all polling stops automatically
- Check current usage anytime: `http://your-server/api/budget`

---

## Useful URLs (once deployed)

| URL | What it does |
|-----|-------------|
| `/health` | Server status |
| `/api/flight/AC123?date=YYYY-MM-DD` | Check a flight |
| `/api/watches` | See active watches |
| `/api/accuracy` | Route accuracy data |
| `/api/budget` | API call count & cost |

---

## Questions?

The most common issue is the server not being reachable from the frontend.
Make sure `API_BASE` in App.jsx matches your Railway URL exactly.
