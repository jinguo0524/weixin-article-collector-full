import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { setAuth } from "./weread-api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = join(__dirname, "..", "auth.json");

async function fetchArticleContent(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.64 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
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

async function main() {
  if (!existsSync(AUTH_PATH)) {
    console.error("Please login first: npm run login");
    process.exit(1);
  }
  const auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
  setAuth(auth.vid, auth.token);

  const { getArticlesWithoutContent, updateArticleContent, closeDb } = await import("./db.js");

  const articles = getArticlesWithoutContent(50);
  if (articles.length === 0) {
    console.log("All articles have content. Nothing to do.");
    closeDb();
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

  console.log(`\nDone! ${fetched}/${articles.length} succeeded.`);
  closeDb();
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
