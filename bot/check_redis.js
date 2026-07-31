require('dotenv').config();
const Redis = require('ioredis');

async function inspectRedis() {
  const redis = new Redis(process.env.REDIS_URL);
  
  try {
    console.log("🗄️ Inspecting Upstash Redis Database...\n");
    
    // Get all keys in database
    const keys = await redis.keys('*');
    console.log(`🔑 Total keys stored in database: ${keys.length}`);
    if (keys.length > 0) {
      console.log(`   Keys present: ${keys.join(', ')}\n`);
    }

    const chatKey = `lgm_bot:chat:${process.env.ALLOWED_GROUP_ID}`;
    const messages = await redis.lrange(chatKey, 0, -1);
    
    console.log(`💬 Rolling Buffer for Chat (${process.env.ALLOWED_GROUP_ID}):`);
    console.log(`   Total buffered messages: ${messages.length}`);
    
    if (messages.length === 0) {
      console.log("   ⚠️ The message list is currently empty because no one has posted in the group since the bot started!");
    } else {
      console.log("\n📜 Transcript stored in Redis (newest to oldest):");
      messages.forEach((msg, idx) => {
        console.log(`   [${idx + 1}] ${msg}`);
      });
    }
  } catch (err) {
    console.error("❌ Error inspecting Redis:", err.message);
  } finally {
    await redis.quit();
  }
}

inspectRedis();
