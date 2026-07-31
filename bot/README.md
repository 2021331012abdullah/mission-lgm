# 🤖 Mission LGM — Chaotic Group Chat Bot (Gemini 3.5 Flash Edition)

A Telegram bot for the Mission LGM competitive programming squad. It passively listens to the group chat, buffers messages in Upstash Redis, syncs solve status from Supabase, and responds with contextual, motivating, and sometimes hilariously chaotic AI-generated replies using **Google Gemini 3.5 Flash**!

## ✨ Features

- **Powered by Gemini 3.5 Flash** — Utilizes Google's state-of-the-art fast multimodal AI model for all conversational logic and media analysis.
- **Live Supabase Tracker Sync** — Fetches today's assigned problems and solve statuses right before replying so the bot knows who solved what today!
- **Dynamic Chaotic Debouncing** — In fast-moving chats, waits for 1 minute of silence before replying. In quiet chats, responds immediately.
- **Voice Note Transcription** — Uses Gemini native audio processing to transcribe voice messages into text for full conversational context.
- **Photo Understanding** — Uses Gemini Vision capabilities to describe images so the bot understands visual shares.
- **50-Message Rolling Buffer** — Persistent via Upstash Redis so context survives server restarts.
- **Mid-Flight Cancellation** — If new messages arrive while the LLM is generating, the stale reply is discarded.
- **CP-Specific Personality** — Congratulates solves, motivates when stuck, drops competitive programming culture references, mixes English with natural conversational Bangla.

## 🔧 Setup

### 1. Get API Keys

| Variable | Source |
|---|---|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) on Telegram |
| `ALLOWED_GROUP_ID` | Pre-configured: `-1003660666440` |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/) |
| `REDIS_URL` | [Upstash Redis](https://upstash.com/) |
| `SUPABASE_URL` | Pre-configured from website |
| `SUPABASE_KEY` | Pre-configured from website |

> ⚠️ **Important:** Send `/setprivacy` to BotFather → select your bot → set to **DISABLE**. This allows the bot to read all group messages.

### 2. Configure Environment

```bash
cd bot
cp .env.example .env
# Edit .env with your actual keys
```

### 3. Install & Run

```bash
cd bot
npm install
npm start
```

### 4. Deploy to Render

1. Commit the `bot/` directory to GitHub
2. Go to [Render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo
4. Set:
   - **Root Directory:** `bot`
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
5. Add all environment variables from `.env`
6. Deploy!
7. Set up a cron job at [cron-job.org](https://cron-job.org) to ping `https://your-app.onrender.com/keepalive` every 14 minutes.

## 📁 Architecture

```
bot/
├── index.js          # Main bot — all modules powered by Gemini 3.5 Flash
├── package.json      # Dependencies (@google/generative-ai, ioredis, @supabase/supabase-js, etc.)
├── .env.example      # Template for environment variables
└── README.md         # This file
```

### Module Breakdown

| Module | Purpose |
|---|---|
| **Module 1** | Express keep-alive server (Render free-tier compatibility) |
| **Module 2** | Message ingestion & multimodal media processing via Gemini |
| **Module 3** | Upstash Redis rolling buffer & Supabase Tracker database sync |
| **Module 4** | Dynamic debouncer (1-min silence threshold) |
| **Module 5** | Gemini 3.5 Flash execution with mid-flight cancellation |
