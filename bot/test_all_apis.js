require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Groq = require('groq-sdk');
const Redis = require('ioredis');

async function checkAllAPIs() {
  console.log("=========================================");
  console.log("    🔍 MISSION LGM - SYSTEM DIAGNOSTICS   ");
  console.log("=========================================\n");

  const results = {
    telegram_me: "PENDING",
    telegram_send: "PENDING",
    groq_text: "PENDING",
    redis_connection: "PENDING"
  };

  // 1. TEST TELEGRAM BOT
  try {
    console.log("🤖 Testing Telegram Bot API...");
    const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
    const me = await bot.getMe();
    console.log(`   ✅ Bot Verified: @${me.username} (${me.first_name})`);
    results.telegram_me = "SUCCESS";

    console.log(`💬 Sending introductory message to group ID: ${process.env.ALLOWED_GROUP_ID}...`);
    const introMsg = "🚀 *LGM Bot Systems Activated!*\n\nAssisting Mission LGM squad on the journey to Legendary Grandmaster! LETS GOOOO 🔥\n\n_System Status check in progress..._";
    const sent = await bot.sendMessage(process.env.ALLOWED_GROUP_ID, introMsg, { parse_mode: 'Markdown' });
    console.log(`   ✅ Introductory message delivered! Message ID: ${sent.message_id}`);
    results.telegram_send = "SUCCESS";
  } catch (error) {
    console.error(`   ❌ Telegram failed: ${error.message}`);
    results.telegram_me = results.telegram_me === "PENDING" ? `FAILED (${error.message})` : results.telegram_me;
    results.telegram_send = `FAILED (${error.message})`;
  }

  console.log("\n-----------------------------------------\n");

  // 2. TEST GROQ LLM API
  try {
    console.log("⚡ Testing Groq LLM API (Llama 3.3 70B)...");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: "user", content: "Say 'Groq online!' and nothing else." }],
      model: "llama-3.3-70b-versatile",
    });
    console.log(`   ✅ Groq Response received: "${chatCompletion.choices[0]?.message?.content}"`);
    results.groq_text = "SUCCESS";
  } catch (error) {
    console.error(`   ❌ Groq API failed: ${error.message}`);
    results.groq_text = `FAILED (${error.message})`;
  }

  console.log("\n-----------------------------------------\n");

  // 3. TEST UPSTASH REDIS DATABASE
  let redis;
  try {
    console.log("🗄️ Testing Upstash Redis Database...");
    redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, retryStrategy: () => null });
    
    // Wait for connection or error
    await new Promise((resolve, reject) => {
      redis.on('ready', () => resolve());
      redis.on('error', (err) => reject(err));
      setTimeout(() => reject(new Error("Connection Timed Out after 5s")), 5000);
    });

    console.log("   ✅ Connected to Upstash Redis!");
    console.log("   Writing test key 'lgm_test_status'...");
    await redis.set("lgm_test_status", "operational", "EX", 60);
    const val = await redis.get("lgm_test_status");
    console.log(`   ✅ Successfully read value back from database: "${val}"`);
    results.redis_connection = "SUCCESS";
  } catch (error) {
    console.error(`   ❌ Upstash Redis failed: ${error.message}`);
    results.redis_connection = `FAILED (${error.message})`;
  } finally {
    if (redis) {
      try { await redis.quit(); } catch {}
    }
  }

  console.log("\n=========================================");
  console.log("        🏁 DIAGNOSTICS SUMMARY           ");
  console.log("=========================================");
  console.table(results);

  process.exit(0);
}

checkAllAPIs();
