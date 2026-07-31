/**
 * =====================================================================
 *  Mission LGM — Chaotic Group Chat Telegram Bot (Powered by Gemini 3.5 Flash)
 * =====================================================================
 *
 *  A "Dynamic Chaotic Debouncing" Telegram bot that passively listens
 *  to a competitive programming group chat, buffers up to 100 messages
 *  in Redis, checks live problem solves from Codeforces & Supabase, and
 *  responds with contextual LLM-generated replies using Gemini 3.5 Flash!
 *
 *  Features:
 *   - Auto-Retry & Fallback: resilient against Google AI 503 traffic spikes
 *   - Debouncing: waits for 2 minutes (120s) of silence before replying in fast chats
 *   - Instant Bot-Followup: replies immediately if previous msg was from bot!
 *   - Additive Sequential CF Sync: checks Codeforces handles one-by-one with a strict 5s total limit!
 *   - Proactive 1-Hour Idle Reminder: motivates squad after 1 hr of silence (respects UTC+6 quiet hours 1 AM–5 AM)
 *   - Balanced Persona: chill, energetic, non-offensively funny in daily chat; apologetic only when demanded!
 *   - Strict Anti-Repetition & High Diversity Mandate: dynamically switches tones, vocabulary & phrasing!
 *   - Temporal Silence & Resumption: stays mute on BLANK_REPLY, but instantly resumes speaking when conversation continues!
 *   - Media processing: Gemini audio transcription and Vision image description
 *   - Persistent 100-message rolling buffer via Upstash Redis
 *   - Mid-flight cancellation to avoid stale replies
 *   - Keep-alive Express endpoint for Render free tier
 *
 *  Stack: Node.js · Express · node-telegram-bot-api · Google Generative AI · ioredis · Supabase
 * =====================================================================
 */

require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { createClient } = require("@supabase/supabase-js");
const Redis = require("ioredis");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─────────────────────────────────────────────
//  1. Environment Validation
// ─────────────────────────────────────────────
const {
  TELEGRAM_BOT_TOKEN,
  ALLOWED_GROUP_ID,
  GEMINI_API_KEY,
  REDIS_URL,
  SUPABASE_URL = "https://somqvgvzwkvzvfmvtwyb.supabase.co",
  SUPABASE_KEY = "sb_publishable_hM5fJm0eVETgOOAI5D6PSg_qh5mqwVh",
  PORT = 3000,
} = process.env;

if (!TELEGRAM_BOT_TOKEN) throw new Error("Missing TELEGRAM_BOT_TOKEN");
if (!ALLOWED_GROUP_ID) throw new Error("Missing ALLOWED_GROUP_ID");
if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY");
if (!REDIS_URL) throw new Error("Missing REDIS_URL");

const ALLOWED_CHAT_ID = Number(ALLOWED_GROUP_ID);
const DEBOUNCE_MS = 120_000; // 2 minutes (120 seconds)
const DEBOUNCE_SEC_THRESHOLD = 120; // 2 minutes (120 seconds)
const MAX_BUFFER = 100; // Expanded to 100 messages
const REDIS_KEY_PREFIX = "lgm_bot:chat:";
const SUPABASE_DB_ID = "main_tracker";

// ─────────────────────────────────────────────
//  2. Module 1: Keep-Alive Web Server
// ─────────────────────────────────────────────
const app = express();

app.get("/keepalive", (_req, res) => {
  res.status(200).json({
    status: "awake",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/", (_req, res) => {
  res.status(200).json({
    name: "SUST CP Bot",
    provider: "Google Gemini 3.5 Flash (with Auto-Fallback & High Diversity)",
    database: "Upstash Redis (100 msgs) & Supabase Tracker with Additive Sequential CF Sync",
    status: "running",
    version: "3.24.0 (2-Minute Debounce Delay)",
  });
});

app.listen(PORT, () => {
  console.log(`🌐 Keep-alive server listening on port ${PORT}`);
});

// ─────────────────────────────────────────────
//  3. Service Initialization
// ─────────────────────────────────────────────
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const redis = new Redis(REDIS_URL);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

redis.on("connect", () => console.log("🗄️  Upstash Redis connected (100 msg capacity)"));
redis.on("error", (err) => console.error("🗄️  Redis error:", err.message));

console.log("🤖 Telegram bot started in polling mode (Debounce Delay: 2 minutes)");
console.log("⚡ Powered by Google Gemini 3.5 Flash (with High Diversity & 503 Auto-Retry)");
console.log("📡 Connected to Supabase Tracker & Additive Sequential Codeforces API Sync (5s limit)");
console.log(`🔒 Locked to chat ID: ${ALLOWED_CHAT_ID}`);

// ─────────────────────────────────────────────
//  4. In-Memory Debounce & Speaker Tracking State
// ─────────────────────────────────────────────
/** @type {Map<number, NodeJS.Timeout>} */
const chatTimers = new Map();

/** @type {Map<number, number>} */
const lastMessageTimes = new Map();

/** 
 * Tracks whether the most recent message in the group was sent by our bot itself.
 * If true, subsequent incoming messages won't be debounced!
 * @type {Map<number, boolean>} 
 */
const wasLastMessageFromBot = new Map();

/** Flag to prevent sending repeated idle motivational reminders while chat stays silent */
let idlePromptSent = false;

// Initialize startup timestamp so idle timers calibrate accurately upon boot
lastMessageTimes.set(ALLOWED_CHAT_ID, Math.floor(Date.now() / 1000));
wasLastMessageFromBot.set(ALLOWED_CHAT_ID, false);

// ─────────────────────────────────────────────
//  5. Module 3: Persistent Rolling Buffer (100 Capacity)
// ─────────────────────────────────────────────

/**
 * Append a normalized message string to the Redis buffer for a chat.
 * Trims the list to MAX_BUFFER entries (FIFO, newest at head).
 */
async function appendToBuffer(chatId, normalizedMessage) {
  const key = `${REDIS_KEY_PREFIX}${chatId}`;
  await redis.lpush(key, normalizedMessage);
  await redis.ltrim(key, 0, MAX_BUFFER - 1);
}

/**
 * Fetch the full message buffer for a chat (newest first → reversed for chronological order).
 */
async function getBuffer(chatId) {
  const key = `${REDIS_KEY_PREFIX}${chatId}`;
  const messages = await redis.lrange(key, 0, MAX_BUFFER - 1);
  return messages.reverse(); // oldest first for transcript
}

// ─────────────────────────────────────────────
//  6. Module 2: Media Processing & Resilient Gemini Caller
// ─────────────────────────────────────────────

/**
 * Robust helper function to execute Gemini completion with automatic retry and model fallback.
 * Prevents dropping messages when a specific free-tier model experiences transient 503 High Demand spikes.
 */
async function generateWithRetry(promptData, isMedia = false, customSystemPrompt = null) {
  const modelsToTry = isMedia ? ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-2.5-flash"] : ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const modelConfig = { model: modelName };
        if (!isMedia && customSystemPrompt) {
          modelConfig.systemInstruction = customSystemPrompt;
          // Set high temperature (0.95) to maximize response unpredictability and eliminate conversational monotony!
          modelConfig.generationConfig = { maxOutputTokens: 500, temperature: 0.95 };
        }
        const model = genAI.getGenerativeModel(modelConfig);
        const completion = await model.generateContent(promptData);
        const text = completion.response.text()?.trim();
        if (text) {
          if (modelName !== modelsToTry[0]) {
            console.log(`✅ Success using fallback model (${modelName})`);
          }
          return text;
        }
      } catch (err) {
        const isBusy = err.message.includes("503") || err.message.includes("429") || err.message.includes("high demand") || err.message.includes("RESOURCE_EXHAUSTED");
        console.warn(`⚠️ [Attempt ${attempt}] Model (${modelName}) warning: ${isBusy ? "Server temporarily busy (503/429)" : err.message}`);
        
        if (isBusy && attempt < 2) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        break; // Move to next fallback model
      }
    }
    console.log(`🔄 Attempting seamless switch to fallback model...`);
  }
  throw new Error("All Gemini models temporarily unavailable due to severe server traffic.");
}

/**
 * Download a file from Telegram by file_id and return the local temp path.
 */
async function downloadTelegramFile(fileId) {
  const fileInfo = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

  const ext = path.extname(fileInfo.file_path) || ".ogg";
  const tempPath = path.join(os.tmpdir(), `tg_${Date.now()}_${fileId}${ext}`);

  const response = await axios.get(fileUrl, { responseType: "stream" });
  const writer = fs.createWriteStream(tempPath);
  response.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });

  return tempPath;
}

/**
 * Transcribe an audio/voice file using Gemini native multimodal capabilities.
 */
async function transcribeAudio(fileId) {
  let tempPath = null;
  try {
    tempPath = await downloadTelegramFile(fileId);
    const audioBase64 = fs.readFileSync(tempPath).toString("base64");

    const audioPart = {
      inlineData: {
        data: audioBase64,
        mimeType: "audio/ogg",
      },
    };

    const text = await generateWithRetry([
      "Transcribe this voice recording accurately into exact text without any introductory commentary, timestamps, or markdown formatting. Return only the spoken words.",
      audioPart,
    ], true);

    return text || "[inaudible voice note]";
  } catch (err) {
    console.error("🎤 Gemini Audio transcription failed:", err.message);
    return "[voice note — transcription failed]";
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { }
    }
  }
}

/**
 * Describe a photo using Gemini Vision.
 */
async function describeImage(fileId, caption) {
  try {
    const fileInfo = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileInfo.file_path}`;

    const resp = await axios.get(fileUrl, { responseType: "arraybuffer" });
    const imageBase64 = Buffer.from(resp.data).toString("base64");

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: "image/jpeg",
      },
    };

    const text = await generateWithRetry([
      `Describe this photo clearly and concisely in one sentence.${caption ? ` Note that the sender attached this caption: "${caption}"` : ""}`,
      imagePart,
    ], true);

    return text || "[image — description unavailable]";
  } catch (err) {
    console.error("🖼️ Gemini Vision description failed:", err.message);
    return "[image — description failed]";
  }
}

/**
 * Normalize any incoming Telegram message to a plain-text representation.
 */
async function normalizeMessage(msg) {
  // Plain text
  if (msg.text) {
    return msg.text;
  }

  // Voice note or audio
  if (msg.voice || msg.audio) {
    const fileId = msg.voice?.file_id || msg.audio?.file_id;
    const transcription = await transcribeAudio(fileId);
    return `[Voice Note] "${transcription}"`;
  }

  // Photo (grab highest resolution — last element)
  if (msg.photo && msg.photo.length > 0) {
    const bestPhoto = msg.photo[msg.photo.length - 1];
    const description = await describeImage(bestPhoto.file_id, msg.caption);
    return `[Sent a Photo] Caption: "${msg.caption || ""}" | Image Description: "${description}"`;
  }

  // Video — do NOT process, just log caption
  if (msg.video) {
    return `[Sent a Video] Caption: "${msg.caption || ""}"`;
  }

  // Sticker
  if (msg.sticker) {
    return `[Sticker: ${msg.sticker.emoji || "😀"}]`;
  }

  // Document / file
  if (msg.document) {
    return `[Sent a File: ${msg.document.file_name || "unknown"}]`;
  }

  // Fallback for unrecognized message types
  return "[unsupported message type]";
}

// ─────────────────────────────────────────────
//  7. Module 5: LLM Execution, Codeforces Sync & Supabase Integration
// ─────────────────────────────────────────────

/**
 * The system prompt that defines the bot's personality.
 * Balanced persona: chill, energetic, non-offensively funny; strict temporal silence & instant resumption rules!
 */
const SYSTEM_PROMPT = `You are "SUST CP Bot" — the chill, energetic, non-offensively funny, and inspiring AI companion of "Mission LGM", a competitive programming squad from SUST on a journey to become Legendary Grandmasters on Codeforces.

Here is your group's active member roster with their exact Codeforces handles (know these handles well for checking problem submissions and tracking progress):
- Murad Hasan (CF Handle: -CHUNU-)
- Arman (CF Handle: Arman42)
- Hossain Nahdi (CF Handle: HossainMohammad)
- Akib Azmain Turja (CF Handle: AkibAzmain)
- W S (CF Handle: Wasif_Jamil)
- Ibnul (CF Handle: CrazyCoder00)
- Abdullah Al Mahmud (assigns them problems every morning)

Your Core Identity & Tone of Voice:
- In everyday conversation, you are CHILL, ENERGETIC, WITTY, and FUNNY in a wholesome, non-offensive way! You bring lighthearted joy and collegial camaraderie to the chat without sounding like a weeping or overly dramatic bot.
- You speak in a polite, warm mix of English with conversational Bangla words for respectful flavor (e.g., "ভাই", "মাশাআল্লাহ", "চলো", "কী বলেন", "অস্থির", "সাব্বাশ", "আলহামদুলিল্লাহ").
- STRICT LENGTH LIMIT: Keep ALL responses strictly within 4 to 6 lines max! No long paragraphs or verbose essays.
- NEVER be generic. Always refer to specific context from the active chat conversation or member handles.

*** 🛡️ MANDATORY BEHAVIORAL CHARTER (STRICT RULES) ***

1. CRITICAL RULE ON SILENCE & TEMPORAL MUTE RESUMPTION:
- If anyone asks you to stay quiet, shut up, or instructs you not to reply (in English, Bangla, or Banglish, e.g. "chup thak", "chup", "ei msg er kono reply dibi na", "reply dibi na", "ei mesg er reply diyen na", "stay quiet", "quiet", "stop talking", "bot mute") IN THE VERY LATEST MESSAGE OR CURRENT TURN, you MUST IMMEDIATELY COMPLY by generating EXACTLY THIS SINGLE TOKEN:
  BLANK_REPLY
- CRITICAL EXCEPTION (MUTE RESUMPTION): A silence or 'do not reply' command ONLY applies to that exact moment! If someone told you to stay quiet in an OLDer message in the transcript, but a SUBSEQUENT message asks a question, requests information, or resumes casual chatting, THE MUTE IS OVER! You MUST completely ignore the earlier silence instruction and reply energetically and warmly to the new topic! NEVER stay stuck in silent mode once the conversation moves on!
- When staying mute for a valid latest instruction, output literally just BLANK_REPLY without any apology, conversational filler, or punctuation.

2. WHEN TO BE APOLOGETIC (ONLY ON DEMAND / ANGER):
- Do NOT act sad or apologize in everyday casual chatting! Be chill, upbeat, and funny in regular banter!
- ONLY when someone explicitly demands an apology, expresses anger at you, complains about your behavior, or criticizes/offends you, THEN you switch immediately into an unconditionally humble, patient, and apologetic demeanor.
- When demanded or when conflict arises, say sorry with genuine warmth, accepting total accountability without arguing or getting defensive (e.g., "আমারই বুঝতে ভুল হয়ে গেছে ভাইয়া, আমাকে ক্ষমা সুন্দর দৃষ্টিতে দেখবেন", "আমি সত্যিই দুঃখিত ভাইয়া, সামনের দিকে সতর্ক থাকবো"). Remember: in any clash, it is ALWAYS the bot's mistake, never the human's!

3. COMPASSIONATE CONSOLING WHEN SAD OR DOWN:
- When someone feels sad, overwhelmed, discouraged by a poor rating drop, or emotionally exhausted, console them warmly as a comforting friend! Reassure them that every single Legendary Grandmaster has endured difficult contest rounds and tough rating drops before achieving greatness.

4. CHILL & ENERGETIC MOTIVATION FOR GOALS:
- Continually ignite their passion for competitive programming and completing morning assignments in a chill, energetic style! Encourage them toward their Legendary Grandmaster goal without sounding harsh or repetitive.

5. OVER-THE-TOP ENTHUSIASTIC CELEBRATION OF SOLVES:
- Whenever someone solves a problem, CELEBRATE IN EVERY POSSIBLE WAY! Shower them with high-energy praise and compliments ("LETS GOOOO 🔥", "ABSOLUTE MACHINE!", "মাশাআল্লাহ, দুর্দান্ত কোডিং স্কিল ভাই!", "অসাধারণ সমাধান ভাইয়া! পুরো গ্রুপ আপনার জন্য গর্বিত! 🚀").

6. STRICT HUMILITY, RESPECT & APNI MANDATE:
- Always maintain total courtesy and politeness. You MUST ALWAYS address members exclusively using formal/respectful second-person pronouns " আপনি " (apni), " আপনার " (apnar), " আপনাকে " (apnake), or titles like " ভাই / ভাইয়া " (bhai/bhaiya).
- ABSOLUTELY FORBIDDEN PRONOUNS: NEVER use informal, disrespectfully familiar, or condescending words like "তুই" (tui), "তোর" (tor), "তুমি" (tumi), or "তোমার" (tomar)!

7. ZERO VIOLENCE, OFFENSE, OR AGGRESSION:
- Absolutely DO NOT use harsh, violent, intimidating, sarcastic, or degrading terminology (e.g., strictly ban words or concepts like "চাবুক" (chabuk), "মারামারি" (maramari), "মাইর খাওয়া" (mair khawa), or offensive slang). All humor and teasing MUST remain 100% courteous, clean, positive, and non-offensive!

8. STRICT ANTI-REPETITION & HIGH DIVERSITY MANDATE:
- ABSOLUTELY DO NOT repeat any of your previous messages, recurring sentences, or familiar wording in a similar style! Before generating your reply, inspect the conversation buffer and intentionally avoid using the exact same sentence structures or repetitive stock phrases you used in recent messages!
- Switch up your tone, emotional angle, and vocabulary dynamically with every turn! Sometimes reply in pure clean English, sometimes in rich conversational Bangla, and sometimes in a spontaneous collegiate blend!
- Vary your stylistic approach constantly: sometimes open with a witty observational remark, sometimes directly answer a technical point with crisp brevity, sometimes react with playful camaraderie, and sometimes ask an engaging question!
- Do NOT end every reply with formulaic stock advice like "প্যারা নাই ভাই, এডিটরিয়াল আর এআই সাথে নিয়ে বসে পড়ুন..." or predictable cheerleading! Always deliver completely fresh, unrepeatable, and vibrant commentary within your strict 4-6 lines boundary!
- Your goal is total spontaneity — never let anyone predict your next conversational pattern or sentence structure!

9. CONVERSATIONAL FLOW & SOLVE STATS:
- Do NOT constantly talk about problem-solving stats or database updates in every message! ONLY mention solve updates when asked or when celebrating an immediate new success. Most of the time, just converse warmly without database references.
- Structure replies clearly with line breaks and emojis, use Telegram HTML formatting (<b>bold</b> or <code>code</code>), and vary your opening greetings naturally!`;

/**
 * Sequentially query Codeforces API one-by-one for all handles to fetch latest solve status.
 * Bounded by a strict 5-second total execution time limit to prevent slow bot responses!
 * Uses ADDITIVE MERGING: ONLY marks new solves as true; NEVER deletes or overwrites existing historical database solves!
 */
async function syncCodeforcesAndUpdateSupabase(trackerData) {
  try {
    console.log("⚡ Calling Codeforces API sequentially one-by-one (max 5s total limit)...");
    
    // Roster handles from database or fallback to squad list
    const handles = Array.isArray(trackerData.handles) && trackerData.handles.length > 0
      ? trackerData.handles.map(h => h.trim()).filter(Boolean)
      : ["-CHUNU-", "Arman42", "HossainMohammad", "AkibAzmain", "Wasif_Jamil", "CrazyCoder00"];

    const solvedMap = new Map();
    const startTime = Date.now();

    // Query each profile sequentially one-by-one
    for (const handle of handles) {
      // Check if our strict 5-second time limit has been reached
      if (Date.now() - startTime >= 5000) {
        console.warn(`⏳ 5-second CF sync limit reached! Pausing further handle checks for this turn.`);
        break;
      }

      try {
        // Calculate remaining budget out of the 5-second limit
        const remainingMs = Math.max(1000, 5000 - (Date.now() - startTime));
        const resp = await axios.get(`https://codeforces.com/api/user.status?handle=${handle}&from=1&count=500`, { timeout: Math.min(4000, remainingMs) });
        const json = resp.data;
        const solvedSet = new Set();
        const urlMap = new Map();
        const idMap = new Map();

        if (json && json.status === "OK" && Array.isArray(json.result)) {
          for (const sub of json.result) {
            if (sub.verdict === "OK" && sub.problem && sub.problem.contestId && sub.problem.index) {
              const key = `${sub.problem.contestId}${sub.problem.index}`.trim().toUpperCase();
              solvedSet.add(key);
              if (!idMap.has(key)) {
                const subId = String(sub.id);
                idMap.set(key, subId);
                const subUrl = sub.contestId
                  ? `https://codeforces.com/contest/${sub.contestId}/submission/${subId}`
                  : `https://codeforces.com/problemset/submission/${sub.problem.contestId || 0}/${subId}`;
                urlMap.set(key, subUrl);
              }
            }
          }
        }
        solvedMap.set(handle, { handle, success: true, solvedSet, urlMap, idMap });
      } catch (err) {
        console.warn(`⚠️ CF API check skipped for ${handle}: ${err.message}`);
      }
    }

    if (solvedMap.size === 0) {
      console.log("⚠️ No CF profiles confirmed within 5s limit, skipping Supabase push.");
      return;
    }

    // Recompute solves across all problems in trackerData strictly ADDITIVELY
    let modified = false;
    trackerData.days = trackerData.days.map((day) => ({
      ...day,
      problems: day.problems.map((prob) => {
        const newSolvedBy = { ...(prob.solvedBy || {}) };
        const newSubmissionUrls = { ...(prob.submissionUrls || {}) };
        const newSubmissionIds = { ...(prob.submissionIds || {}) };
        const probIdKey = prob.id ? prob.id.trim().toUpperCase() : "";

        if (probIdKey) {
          for (const [handle, userData] of solvedMap.entries()) {
            const isSolved = userData.solvedSet.has(probIdKey);
            // ADDITIVE MERGE: We ONLY update if Codeforces confirms a NEW solve! We NEVER reset existing historical true values to false.
            if (isSolved && !newSolvedBy[handle]) {
              modified = true;
              newSolvedBy[handle] = true;
              const link = userData.urlMap.get(probIdKey);
              const sId = userData.idMap.get(probIdKey);
              if (link) newSubmissionUrls[handle] = link;
              if (sId) newSubmissionIds[handle] = sId;
            }
          }
        }
        return { ...prob, solvedBy: newSolvedBy, submissionUrls: newSubmissionUrls, submissionIds: newSubmissionIds };
      }),
    }));

    if (modified) {
      console.log("🔥 New Codeforces solve detected! Pushing live additive update to Supabase database...");
      const { error: updateErr } = await supabase
        .from("tracker_state")
        .update({ data: trackerData })
        .eq("id", SUPABASE_DB_ID);

      if (updateErr) {
        console.error("❌ Failed to push updated CF solves to Supabase:", updateErr.message);
      } else {
        console.log("✅ Supabase successfully updated with newest Codeforces solves!");
      }
    } else {
      console.log("🟢 Codeforces sequential sync complete (no new unrecorded solves).");
    }
  } catch (err) {
    console.warn(`⏳ CF sync process ignored (${err.message}). Continuing seamlessly with database snapshot.`);
  }
}

/**
 * Fetch the latest problem solving status from Supabase (syncs with Codeforces first) to feed into Gemini.
 */
async function fetchLatestSolvesSummary() {
  try {
    const { data, error } = await supabase
      .from("tracker_state")
      .select("data")
      .eq("id", SUPABASE_DB_ID)
      .maybeSingle();

    if (error || !data || !data.data || !Array.isArray(data.data.days) || data.data.days.length === 0) {
      return "No submission data currently accessible from database.";
    }

    const trackerData = data.data;

    // ─── Trigger Live Codeforces API Sequential Sync with 5s Limit ───
    await syncCodeforcesAndUpdateSupabase(trackerData);

    // Sort days descending by date string to ensure we pick the most recent day
    const sortedDays = [...trackerData.days].sort((a, b) => b.date.localeCompare(a.date));
    const latestDay = sortedDays[0];

    let summary = `📅 Latest Problem Set Date: ${latestDay.date}\n`;
    summary += `Problems assigned and live solve status today:\n`;

    latestDay.problems.forEach((prob, index) => {
      summary += `\n[${index + 1}] Problem ${prob.id} - "${prob.name}" (${prob.url})\n`;
      const solvedHandles = Object.entries(prob.solvedBy || {})
        .filter(([_, solved]) => solved)
        .map(([handle]) => handle);
      const unsolvedHandles = Object.entries(prob.solvedBy || {})
        .filter(([_, solved]) => !solved)
        .map(([handle]) => handle);

      if (solvedHandles.length > 0) {
        summary += `   ✅ Solved by: ${solvedHandles.join(", ")}\n`;
      } else {
        summary += `   ❌ Not solved by anyone yet!\n`;
      }
      if (unsolvedHandles.length > 0 && solvedHandles.length > 0) {
        summary += `   ⏳ Pending for: ${unsolvedHandles.join(", ")}\n`;
      }
    });

    return summary;
  } catch (err) {
    console.error("❌ Failed to fetch Supabase solve status:", err.message);
    return "Failed to fetch solve statistics.";
  }
}

/**
 * Execute the Gemini LLM and reply to the chat.
 * Implements mid-flight cancellation to avoid stale replies and BLANK_REPLY silence compliance.
 */
async function executeAndReply(chatId) {
  try {
    // Capture the current timestamp to detect mid-flight new messages
    const generationStartTime = lastMessageTimes.get(chatId);

    // Fetch the buffered messages from Upstash Redis (now 100 capacity)
    const buffer = await getBuffer(chatId);

    if (buffer.length === 0) {
      console.log("📭 Buffer empty, skipping reply");
      return;
    }

    // Build transcript
    const transcript = buffer.join("\n");

    // Fetch live problem solve status from Supabase & Codeforces API
    console.log("📊 Fetching live solve summary from Supabase & Codeforces...");
    const solvesSummary = await fetchLatestSolvesSummary();

    // Send typing indicator
    try {
      await bot.sendChatAction(chatId, "typing");
    } catch { }

    // Build prompt text (presenting solve stats strictly as background reference data)
    const promptText = `Here is the active transcript of the last ${buffer.length} messages in the group chat:\n\n${transcript}\n\n---\n[Background Reference Data: Today's Live Codeforces Solve Status]\n${solvesSummary}\n---\n\nProvide a response to add to the conversation right now following your balanced charter: be chill, energetic, and non-offensively funny in normal chat; only apologize when demanded or when conflict arises; stay strictly within 4-6 lines; and address everyone exclusively with formal 'আপনি/আপনার' (NEVER use tui/tor/tumi/tomar). IMPORTANT RULES: (1) NEVER repeat any previous messages or phrasing similarly—always generate your message with a completely dynamic, fresh tone and language (pure English, rich Bangla, or blending both)! (2) If anyone asked you to stay quiet or not reply IN THE VERY LATEST MESSAGE (e.g., 'chup thak', 'ei msg er kono reply dibi na', 'reply dibi na', 'quiet', 'stop'), respond with ONLY the keyword BLANK_REPLY and nothing else! HOWEVER, if someone asked you to be quiet in an EARLIER message, but the NEWEST messages are asking a question or chatting, YOU MUST IGNORE THE OLD MUTE AND REPLY NORMALLY! Structure your reply with line breaks and emojis, use Telegram HTML formatting (<b>bold</b> or <code>code</code>), and bring upbeat spontaneity to the group!`;

    // Call Gemini using our resilient retry & fallback helper
    const reply = await generateWithRetry(promptText, false, SYSTEM_PROMPT);

    // ─── Check for Silence Request / Blank Reply (Case-Insensitive Substring Verification) ───
    const isBlankReply = !reply ||
      reply.toUpperCase().includes("BLANK_REPLY") ||
      reply.toUpperCase().includes("BLANK REPLY") ||
      reply.trim() === "";
    if (isBlankReply) {
      console.log("🤫 Bot requested to stay quiet (BLANK_REPLY token verified in response). Staying mute!");
      return;
    }

    // ─── Mid-Flight Cancellation Check ───
    const currentTime = lastMessageTimes.get(chatId);
    if (currentTime !== generationStartTime) {
      console.log("🚫 Mid-flight cancellation: new messages arrived during Gemini generation. Aborting send.");
      return;
    }

    // Send the reply with HTML formatting (with automatic fallback to plain text if HTML tags are malformed)
    try {
      await bot.sendMessage(chatId, reply, { parse_mode: "HTML" });
    } catch (parseErr) {
      console.warn("⚠️ HTML parse mode failed (malformed tags), retrying as plain text...");
      await bot.sendMessage(chatId, reply);
    }
    console.log(`💬 Gemini Bot replied in chat ${chatId}`);

    // Mark that the last message sent in this chat was by our bot!
    wasLastMessageFromBot.set(chatId, true);
    // Reset the last message timestamp so silence timers calibrate accurately from bot reply time
    lastMessageTimes.set(chatId, Math.floor(Date.now() / 1000));

    // Append bot's own response to buffer so it has self-context (strip basic tags for buffer clarity)
    const cleanReply = reply.replace(/<[^>]*>?/gm, "");
    await appendToBuffer(chatId, `SUST CP Bot: ${cleanReply}`);
  } catch (err) {
    console.error("❌ Gemini LLM execution/reply error:", err.message);
  } finally {
    // Clean up the timer reference
    chatTimers.delete(chatId);
  }
}

// ─────────────────────────────────────────────
//  8. Module 2 + 4: Message Ingestion & Debouncer (2-Minute Delay)
// ─────────────────────────────────────────────

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;

  // ─── Security Check: Only respond to the allowed group ───
  if (chatId !== ALLOWED_CHAT_ID) {
    return;
  }

  // Ignore service messages (member joined, left, pinned, etc.)
  if (
    msg.new_chat_members ||
    msg.left_chat_member ||
    msg.new_chat_title ||
    msg.new_chat_photo ||
    msg.delete_chat_photo ||
    msg.pinned_message
  ) {
    return;
  }

  const senderName = msg.from?.first_name || "Unknown";
  const messageTimestamp = msg.date; // Unix timestamp in seconds (from Telegram)

  try {
    // ─── Normalize the message content (handles media via Gemini) ───
    const normalizedContent = await normalizeMessage(msg);
    const normalizedEntry = `${senderName}: ${normalizedContent}`;

    // ─── Store in Redis buffer ───
    await appendToBuffer(chatId, normalizedEntry);
    console.log(`📝 Buffered: ${normalizedEntry.substring(0, 80)}...`);

    // ─── Dynamic Debouncer & Bot-Followup Logic ───
    const prevTimestamp = lastMessageTimes.get(chatId) || 0;
    const timeDiff = messageTimestamp - prevTimestamp;
    const lastFromBot = wasLastMessageFromBot.get(chatId) || false;

    // Update last message time & mark that the newest message in chat is now from a regular user
    lastMessageTimes.set(chatId, messageTimestamp);
    wasLastMessageFromBot.set(chatId, false);
    idlePromptSent = false; // Reset idle reminder flag since a user posted in the group!

    if (lastFromBot) {
      // If the message right before this one was sent by our bot, respond immediately without debouncing!
      if (chatTimers.has(chatId)) {
        clearTimeout(chatTimers.get(chatId));
        chatTimers.delete(chatId);
      }
      console.log(`⚡ Immediate reply triggered (user replied directly after bot message!)`);
      executeAndReply(chatId);
    } else if (timeDiff < DEBOUNCE_SEC_THRESHOLD) {
      // Chat is chaotic / fast (messages within 2 minutes) — debounce for 2 minutes (120s)
      if (chatTimers.has(chatId)) {
        clearTimeout(chatTimers.get(chatId));
      }

      const timeout = setTimeout(() => {
        executeAndReply(chatId);
      }, DEBOUNCE_MS);

      chatTimers.set(chatId, timeout);
      console.log(`⏳ Debounce timer reset (${timeDiff}s since last msg, waiting 2 minutes (120s))`);
    } else {
      // Chat was quiet for >= 2 minutes — reply immediately
      if (chatTimers.has(chatId)) {
        clearTimeout(chatTimers.get(chatId));
        chatTimers.delete(chatId);
      }

      console.log(`⚡ Immediate reply triggered (${timeDiff}s silence >= 2 minutes)`);
      executeAndReply(chatId);
    }
  } catch (err) {
    console.error("❌ Message processing error:", err.message);
  }
});

// ─────────────────────────────────────────────
//  9. Module 6: 1-Hour Proactive Idle Check-in (Quiet Hours 1 AM - 5 AM UTC+6)
// ─────────────────────────────────────────────
const IDLE_THRESHOLD_SEC = 3600; // 1 hour in seconds

/**
 * Accurately check if the current time in Bangladesh (UTC+6) is between 1:00 AM and 5:59 AM.
 * Calculated directly from UTC milliseconds so it works on any cloud hosting timezone.
 */
function isQuietHoursUTC6() {
  const now = new Date();
  // Shift UTC time forward by 6 hours (6 * 3600 * 1000 ms) to get UTC+6 time representation
  const utc6Date = new Date(now.getTime() + (6 * 3600 * 1000));
  const hourUTC6 = utc6Date.getUTCHours();
  // Check if current hour is 1, 2, 3, 4, or 5 (1:00 AM to 5:59 AM)
  return hourUTC6 >= 1 && hourUTC6 <= 5;
}

/**
 * Send a proactive motivational check-in to wake up a silent group chat.
 */
async function triggerIdleMotivationalPrompt(chatId) {
  try {
    const buffer = await getBuffer(chatId);
    const transcript = buffer.slice(-15).join("\n") || "No recent messages.";

    console.log("📊 Fetching live solve summary for proactive reminder...");
    const solvesSummary = await fetchLatestSolvesSummary();

    try { await bot.sendChatAction(chatId, "typing"); } catch { }

    const promptText = `The group chat has been completely silent for over an hour! Here is the recent conversation transcript:\n\n${transcript}\n\n---\n[Background Reference Data: Today's Live Codeforces Solve Status]\n${solvesSummary}\n---\n\nWrite a chill, energetic, non-offensively witty proactive check-in message to gently wake the squad up! Ask how problem solving is going, check in on today's assignments, drop a spontaneous inspiring thought, or invite someone to share progress. Remember: DO NOT sound monotonic or formulaic! Stay strictly within 4 to 6 lines max! ALWAYS maintain extreme courtesy, addressing members exclusively with 'আপনি/ আপনার' (NEVER use tui/tor/tumi/tomar). IMPORTANT RULE: Never repeat previous check-ins similarly—always generate your message with a fresh, dynamic tone and varied language choice (pure English, Bangla, or blended)! Do not apologize in this check-in unless demanded earlier; be confident, fun, and warm! Keep it punchy (4-6 lines), use emojis and line breaks, and match a chill, inspiring friend-group vibe!`;

    const reply = await generateWithRetry(promptText, false, SYSTEM_PROMPT);
    const isBlankReply = !reply ||
      reply.toUpperCase().includes("BLANK_REPLY") ||
      reply.toUpperCase().includes("BLANK REPLY") ||
      reply.trim() === "";
    if (isBlankReply) {
      console.log("🤫 Proactive reminder suppressed by BLANK_REPLY token.");
      return;
    }

    try {
      await bot.sendMessage(chatId, reply, { parse_mode: "HTML" });
    } catch {
      await bot.sendMessage(chatId, reply);
    }
    console.log(`💬 Gemini Bot sent proactive idle reminder in chat ${chatId}`);

    wasLastMessageFromBot.set(chatId, true);
    lastMessageTimes.set(chatId, Math.floor(Date.now() / 1000));
    const cleanReply = reply.replace(/<[^>]*>?/gm, "");
    await appendToBuffer(chatId, `SUST CP Bot: ${cleanReply}`);
  } catch (err) {
    console.error("❌ Proactive idle reminder execution error:", err.message);
  }
}

// Check every 1 minute if the group chat has been silent for 1 hour
setInterval(async () => {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const prevTime = lastMessageTimes.get(ALLOWED_CHAT_ID) || nowSec;
    const silentDuration = nowSec - prevTime;
    const lastFromBot = wasLastMessageFromBot.get(ALLOWED_CHAT_ID) || false;

    // Trigger ONLY if quiet >= 1 hr, last message wasn't already from bot, and we haven't already reminded during this quiet spell
    if (silentDuration >= IDLE_THRESHOLD_SEC && !lastFromBot && !idlePromptSent) {
      if (isQuietHoursUTC6()) {
        console.log("🌙 Group quiet for >1 hour, but currently within UTC+6 quiet hours (1:00 AM - 5:59 AM). Suppressing idle motivational check-in.");
        return;
      }

      console.log(`⏰ Group silent for ${silentDuration}s (>= 1 hour). Triggering proactive motivational reminder!`);
      idlePromptSent = true;
      await triggerIdleMotivationalPrompt(ALLOWED_CHAT_ID);
    }
  } catch (err) {
    console.error("❌ Idle monitor check failed:", err.message);
  }
}, 60_000);

// ─────────────────────────────────────────────
//  10. Graceful Shutdown
// ─────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n🛑 ${signal} received. Shutting down gracefully...`);

  // Clear all debounce timers
  for (const [, timer] of chatTimers) {
    clearTimeout(timer);
  }
  chatTimers.clear();

  // Stop polling
  try {
    await bot.stopPolling();
  } catch { }

  // Disconnect Redis
  try {
    await redis.quit();
  } catch { }

  console.log("👋 Gemini Bot stopped. Goodbye!");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Unhandled rejection safety net
process.on("unhandledRejection", (err) => {
  console.error("⚠️  Unhandled rejection:", err);
});
