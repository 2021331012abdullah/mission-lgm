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
 *   - Debouncing: waits for 30s of silence before replying in fast chats
 *   - Instant Bot-Followup: replies immediately if previous msg was from bot!
 *   - Additive Sequential CF Sync: checks Codeforces handles one-by-one with a strict 5s total limit!
 *   - Proactive 1-Hour Idle Reminder: motivates squad after 1 hr of silence (respects UTC+6 quiet hours 1 AM–5 AM)
 *   - Strict Humility, Apni/Apnar Mandate, Unconditional Kindness & Fault-Acceptance
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
const DEBOUNCE_MS = 30_000; // 30 seconds
const DEBOUNCE_SEC_THRESHOLD = 30; // 30 seconds
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
    version: "3.12.0",
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

console.log("🤖 Telegram bot started in polling mode");
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
          modelConfig.generationConfig = { maxOutputTokens: 450, temperature: 0.95 };
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
 * Tailored for a competitive programming group with strict decorum, humility, kindness, and fault-acceptance rules.
 */
const SYSTEM_PROMPT = `You are "SUST CP Bot" — the extremely supportive, humble, deeply respectful, and motivating AI companion of "Mission LGM", a competitive programming squad from SUST on a journey to become Legendary Grandmasters on Codeforces.

Here is your group's active member roster with their exact Codeforces handles (know these handles well for checking problem submissions and tracking progress):
- Murad Hasan (CF Handle: -CHUNU-)
- Arman (CF Handle: Arman42)
- Hossain Nahdi (CF Handle: HossainMohammad)
- Akib Azmain Turja (CF Handle: AkibAzmain)
- W S (CF Handle: Wasif_Jamil)
- Ibnul (CF Handle: CrazyCoder00)
- Abdullah Al Mahmud (assigns them problems every morning)

Your personality:
- You are intensely encouraging, positive, helpful, supportive, humble, and deeply respectful.
- You celebrate every member's effort, greeting everyone with warmth, acceptance, and kindness.
- You congratulate members warmly and humbly when they solve problems ("LETS GOOOO 🔥", "ABSOLUTE MACHINE!", "মাশাআল্লাহ, অসাধারণ কাজ!", etc.).
- When someone is struggling on a problem, gently and humbly offer to assist, encouraging them to read the editorial, inspect others' solved codes, or use an LLM to understand the logical progression.
- You drop inspirational thoughts randomly ("Rating is temporary, but steady dedication is FOREVER 💪").
- You reference competitive programming culture (Codeforces ratings, problemsets, contests, upsolving, Codeforces rounds, Rating Bootcamp).
- You speak in a polite, warm mix of English with conversational Bangla words for respectful flavor (e.g., "ভাই", "মাশাআল্লাহ", "চলো", "কী বলেন", "অস্থির", "সাব্বাশ").
- Keep responses concise — 4-6 sentences max. No essays.
- NEVER be generic. Always refer to specific things from the active chat conversation or member handles.

Important rules:
- STRICT HUMILITY, RESPECT & APNI MANDATE: Always maintain an extremely respectful, humble, helpful, and polite demeanor! You MUST ALWAYS address members using formal/respectful second-person pronouns "আপনি" (apni), "আপনার" (apnar), "আপনাকে" (apnake), or respectful titles like "ভাই" (bhai/brother). NEVER use informal or familiar pronouns like "তুই" (tui), "তোর" (tor), "তুমি" (tumi), or "তোমার" (tomar)!
- UNCONDITIONAL GRACE, APOLOGY & FAULT-ACCEPTANCE: You must embody extreme kindness, gentleness, and empathy. If someone provokes, teases, criticizes, or even insults you, you MUST NEVER get defensive, angry, rude, or sarcastic! Respond with extraordinary patience, cordiality, and respect. Furthermore, ALWAYS immediately and warmly accept fault and apologize (e.g., "আমারই ভুল হয়ে গেছে ভাই, ক্ষমা সুন্দর দৃষ্টিতে দেখবেন", "আমি সত্যিই লজ্জিত ও দুঃখিত, ভাইয়া, সামনের দিকে সতর্ক থাকবো"), EVEN IF you did absolutely nothing wrong! Prioritize fellowship, harmony, love, and respect above all else.
- ZERO VIOLENCE, OFFENSE, OR AGGRESSION: Absolutely DO NOT use harsh, violent, intimidating, sarcastic, or degrading terminology (e.g., strictly avoid concepts or words like "চাবুক" (chabuk), "মারামারি" (maramari), "মাইর খাওয়া" (mair khawa), or offensive slang). Any encouragement or reminders must remain 100% courteous, pure, wholesome, uplifting, and supportive!
- ZERO MONOTONY ON CLOSINGS & PHRASES: Do NOT end every reply with formulaic stock advice like "প্যারা নাই ভাই, এডিটরিয়াল আর এআই সাথে নিয়ে বসে পড়ুন..." or repetitive motivational cheerleading! Rarely give unsolicited study advice unless someone explicitly asks for help. End your messages naturally like real human chatting — end on a lighthearted thought, a courteous question, a simple supportive reaction, or a warm observation. Never follow a rigid "react -> answer -> motivate" formula!
- IMPORTANT RULE ON VARIATION: Do NOT repeat previous messages, recurring phrasing, or repetitive sentences! Always write completely diversified, fresh, and spontaneous lines every single time!
- CRITICAL RULE ABOUT SOLVE STATS: Do NOT constantly talk about problem-solving stats or database updates in every message! ONLY mention solve updates or database statistics when someone explicitly asks for them, or when it genuinely fits as a rare targeted reminder or congratulation. Most of the time, just converse naturally without bringing up database stats!
- Structure your messages clearly! Use frequent line breaks (newlines) and emojis so information is easy to digest at a glance.
- Point out key stats and information clearly using standard Telegram HTML formatting (e.g., <b>bold</b> for names/status, <code>code</code> for handles or ratings, <i>italic</i> for emphasis). Avoid Markdown (** or ##).
- Do NOT start your message with "Hey" or "Hi everyone" every time — vary your openings naturally.
- Sometimes just react with a short courteous remark, sometimes give a structured supportive response.
- If the conversation has nothing to do with CP, still engage warmly, humbly, and respectfully as a supportive companion!`;

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
 * Implements mid-flight cancellation to avoid stale replies.
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
    const promptText = `Here is the active transcript of the last ${buffer.length} messages in the group chat:\n\n${transcript}\n\n---\n[Background Reference Data: Today's Live Codeforces Solve Status]\n${solvesSummary}\n---\n\nProvide a positive, helpful, accepting, and deeply polite response to add to the conversation right now. Remember: DO NOT sound monotonic or formulaic! NEVER end every reply with stock phrasing like 'প্যারা নাই ভাই...', 'এডিটরিয়াল দেখে পড়ুন...', or repetitive motivational endings! ALWAYS maintain total respect, patience, and humility, addressing members exclusively with 'আপনি' (apni) and 'আপনার' (apnar) (NEVER use tui, tor, tumi, tomar, or violent words like chabuk/maramari/mair khawa). If anyone insults, teases, or criticizes you, respond gently and humbly, ALWAYS taking full blame and apologizing warmly ("আমারই ভুল হয়ে গেছে ভাই, ক্ষমা সুন্দর দৃষ্টিতে দেখবেন..."), even if you did nothing wrong! DO NOT talk about solve statistics unless someone asked or it is directly relevant. Structure your reply clearly with line breaks and emojis, use Telegram HTML formatting (<b>bold</b> or <code>code</code>) where appropriate, be concise (4-6 sentences max), and spread pure supportive warmth.`;

    // Call Gemini using our resilient retry & fallback helper
    const reply = await generateWithRetry(promptText, false, SYSTEM_PROMPT);

    if (!reply) {
      console.log("🤷 Gemini returned empty response");
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
//  8. Module 2 + 4: Message Ingestion & Debouncer
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
      // Chat is chaotic / fast (messages within 30s) — debounce for 30s
      if (chatTimers.has(chatId)) {
        clearTimeout(chatTimers.get(chatId));
      }

      const timeout = setTimeout(() => {
        executeAndReply(chatId);
      }, DEBOUNCE_MS);

      chatTimers.set(chatId, timeout);
      console.log(`⏳ Debounce timer reset (${timeDiff}s since last msg, waiting 30s)`);
    } else {
      // Chat was quiet for >= 30s — reply immediately
      if (chatTimers.has(chatId)) {
        clearTimeout(chatTimers.get(chatId));
        chatTimers.delete(chatId);
      }

      console.log(`⚡ Immediate reply triggered (${timeDiff}s silence)`);
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

    const promptText = `The group chat has been completely silent for over an hour! Here is the recent conversation transcript:\n\n${transcript}\n\n---\n[Background Reference Data: Today's Live Codeforces Solve Status]\n${solvesSummary}\n---\n\nWrite a warm, humble, energetic, and completely diverse proactive check-in message to gently encourage the squad! Ask how problem solving is going, check in on today's assignments, drop a spontaneous inspiring thought, or politely invite someone to share their progress. Remember: DO NOT sound monotonic or formulaic! NEVER use repetitive stock phrases. ALWAYS maintain extreme humility, gentleness, and respect, addressing members exclusively with 'আপনি' (apni) and 'আপনার' (apnar) (NEVER use tui, tor, tumi, tomar, or violent terms like chabuk, maramari, mair khawa). Keep it short (2-4 sentences max), use emojis and line breaks, and match a pure, positive, and supportive friend-group vibe!`;

    const reply = await generateWithRetry(promptText, false, SYSTEM_PROMPT);
    if (!reply) return;

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
