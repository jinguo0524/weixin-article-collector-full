import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setAuth } from "./weread-api.js";
import { TARGET_ACCOUNTS } from "../config.js";
import * as cheerio from "cheerio";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = join(__dirname, "..", "auth.json");
const ACCOUNTS_PATH = join(__dirname, "..", "data", "accounts.json");

function loadAuth() {
  if (!existsSync(AUTH_PATH)) {
    console.error("No auth credentials found. Please run: npm run login");
    process.exit(1);
  }
  return JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
}

function loadAccounts() {
  if (existsSync(ACCOUNTS_PATH)) return JSON.parse(readFileSync(ACCOUNTS_PATH, "utf-8"));
  return [];
}

function saveAccounts(accounts) {
  const dir = dirname(ACCOUNTS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

// -- setup mode --

function setupMode() {
  console.log("=== First-time Setup: Add Target Public Accounts ===\n");
  console.log("Please provide one WeChat article link for each public account:\n");
  TARGET_ACCOUNTS.forEach((a, i) => console.log(`  ${i + 1}. ${a.name}`));
  console.log("\nUsage:");
  console.log('  npm run setup -- --add "Account Name" "https://mp.weixin.qq.com/s/xxxxx"\n');
  const existing = loadAccounts();
  if (existing.length > 0) {
    console.log("Configured accounts:");
    existing.forEach((a) => console.log(`  ${a.name} (ID: ${a.id})`));
  }
  console.log("\nTip: In WeChat, open the account's home page, tap any article → top-right '...' → 'Copy Link'");
}

async function addAccount(name, url) {
  const auth = loadAuth();
  setAuth(auth.vid, auth.token);
  const { wxs2mp } = await import("./weread-api.js");
  try {
    console.log(`Looking up public account: ${name}...`);
    const results = await wxs2mp(url);
    if (!results || results.length === 0) {
      console.error("No account found. Please check the link.");
      return false;
    }
    const mp = results[0];
    console.log(`Found: ${mp.name || name} (ID: ${mp.id})`);
    const accounts = loadAccounts();
    const idx = accounts.findIndex((a) => a.name === name);
    const entry = { name: mp.name || name, id: mp.id, intro: mp.intro || "", cover: mp.cover || "" };
    if (idx >= 0) accounts[idx] = entry;
    else accounts.push(entry);
    saveAccounts(accounts);
    console.log("Saved to data/accounts.json");
    return true;
  } catch (e) {
    console.error(`Add failed: ${e.message}`);
    return false;
  }
}

// -- content fetching --

async function fetchArticleContent(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  });
  if (!res.ok) return null;
  const html = await res.text();

  // Try to extract from content_noencode JS variable (current WeChat format)
  const noencodeMatch = html.match(/content_noencode:\s*'([^']*)'/);
  if (noencodeMatch) {
    const raw = noencodeMatch[1];
    const content = raw.replace(/\\x0a/g, "\n").replace(/\\x22/g, '"').replace(/\\x27/g, "'").replace(/\\x5c/g, "\\").trim();
    if (content) return { content, htmlContent: content };
  }

  // Fallback: try #js_content element (older WeChat format)
  const $ = cheerio.load(html);
  const content = $("#js_content").text().trim();
  const htmlContent = $("#js_content").html() || "";
  return { content, htmlContent };
}

// -- sync mode: incremental + base maintenance --

function getTodayRange() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  return {
    startTs: Math.floor(yesterdayStart.getTime() / 1000),
    endTs: Math.floor(todayStart.getTime() / 1000 + 24 * 60 * 60),
  };
}

async function syncMode() {
  const auth = loadAuth();
  setAuth(auth.vid, auth.token);

  const accounts = loadAccounts();
  if (accounts.length === 0) {
    console.error("No accounts configured. Please run: npm run setup");
    process.exit(1);
  }

  const { getArticles } = await import("./weread-api.js");
  const { upsertAccount, upsertArticle, updateArticleContent, closeDb } = await import("./db.js");

  const { startTs, endTs } = getTodayRange();
  console.log(`Starting incremental sync for ${accounts.length} accounts (yesterday+today)...\n`);

  let totalNew = 0;

  for (const acc of accounts) {
    try {
      process.stdout.write(`${acc.name}... `);
      // Only fetch page 1 (latest ~20 articles) -- enough for yesterday+today
      const articles = await getArticles(acc.id, 1);
      upsertAccount(acc.id, acc.name, acc.intro, acc.cover);

      let newForAccount = 0;
      for (const art of articles) {
        // Only keep articles from yesterday or today
        if (art.publishTime < startTs || art.publishTime >= endTs) continue;

        upsertArticle(
          art.id, acc.id, art.title,
          art.url || `https://mp.weixin.qq.com/s/${art.id}`,
          art.picUrl || "", art.publishTime || 0
        );
        newForAccount++;
      }
      console.log(`${newForAccount} new articles`);
      totalNew += newForAccount;
    } catch (e) {
      console.log(`Error: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nIncremental sync complete. ${totalNew} new articles total.\n`);

  // Fetch content for newly added articles
  if (totalNew > 0) {
    await fetchContentForNewArticles();
  }

  // Prune: keep only latest 20 per account
  await pruneOldArticles();

  closeDb();
}

async function fetchContentForNewArticles() {
  const { getArticlesWithoutContent, updateArticleContent, closeDb } = await import("./db.js");
  const articles = getArticlesWithoutContent(200);
  if (articles.length === 0) {
    console.log("All articles have content. Skipping.");
    return;
  }

  console.log(`Fetching content for ${articles.length} articles...\n`);

  let fetched = 0;
  for (let i = 0; i < articles.length; i++) {
    const art = articles[i];
    try {
      process.stdout.write(`[${i + 1}/${articles.length}] ${art.id.substring(0, 12)}... `);
      const result = await fetchArticleContent(art.url);
      if (result && result.content) {
        updateArticleContent(art.id, result.content, result.htmlContent);
        console.log(`OK (${result.content.length} chars)`);
        fetched++;
      } else {
        console.log("Empty content");
      }
    } catch (e) {
      console.log(`Failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log(`\nContent fetch complete. ${fetched}/${articles.length} succeeded.`);
  closeDb();
}

async function pruneOldArticles() {
  const { getDb, closeDb } = await import("./db.js");
  const db = getDb();
  const accounts = db.prepare("SELECT DISTINCT account_id FROM articles").all();

  for (const acc of accounts) {
    const ids = db.prepare(
      "SELECT id FROM articles WHERE account_id = ? ORDER BY publish_at DESC"
    ).all(acc.account_id);
    if (ids.length > 20) {
      for (const row of ids.slice(20)) {
        db.prepare("DELETE FROM articles WHERE id = ?").run(row.id);
      }
    }
  }
  closeDb();
}

// -- entry --

const args = process.argv.slice(2);
const mode = args[0];

if (mode === "--setup" && args[1] === "--add") {
  const name = args[2];
  const url = args[3];
  if (!name || !url) {
    console.error("Usage: node src/sync.js --setup --add <Account Name> <Article Link>");
    process.exit(1);
  }
  const ok = await addAccount(name, url);
  process.exit(ok ? 0 : 1);
} else if (mode === "--setup") {
  setupMode();
} else {
  await syncMode();
}
