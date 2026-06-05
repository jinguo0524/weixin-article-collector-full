import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGET_ACCOUNTS } from "../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_PATH = join(__dirname, "..", "data", "accounts.json");
const OUTPUT_DIR = join(__dirname, "..", "output");

function getDateRange() {
  // Yesterday and today
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  return {
    startTs: Math.floor(yesterdayStart.getTime() / 1000),
    endTs: Math.floor(todayStart.getTime() / 1000 + 24 * 60 * 60),
  };
}

function formatDate(ts) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function main() {
  const accounts = existsSync(ACCOUNTS_PATH)
    ? JSON.parse(readFileSync(ACCOUNTS_PATH, "utf-8"))
    : [];
  const { getDb, closeDb } = await import("./db.js");

  const db = getDb();
  const { startTs, endTs } = getDateRange();

  // Get articles from yesterday and today
  const articles = db
    .prepare(
      `SELECT a.*, ac.name as account_name FROM articles a
       JOIN accounts ac ON a.account_id = ac.id
       WHERE a.publish_at >= ? AND a.publish_at < ?
       ORDER BY a.account_id, a.publish_at DESC`
    )
    .all(startTs, endTs);

  if (articles.length === 0) {
    console.log("No new articles from yesterday and today.");
    closeDb();
    return;
  }

  // Group by date
  const byDate = {};
  for (const art of articles) {
    const dateKey = formatDate(art.publish_at);
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push(art);
  }

  // Output per date
  for (const [dateKey, arts] of Object.entries(byDate)) {
    const dateDir = join(OUTPUT_DIR, dateKey);
    if (!existsSync(dateDir)) mkdirSync(dateDir, { recursive: true });

    let summaryMd = `## Article List (${dateKey})\n\n`;

    for (const target of TARGET_ACCOUNTS) {
      const accArts = arts.filter((a) => a.account_name === target.name);
      summaryMd += `### ${target.name}\n`;

      if (accArts.length === 0) {
        summaryMd += "- No updates today\n\n";
        continue;
      }

      for (const art of accArts) {
        const time = formatTime(art.publish_at);
        const url = art.url || `https://mp.weixin.qq.com/s/${art.id}`;
        summaryMd += `- [${art.title}](${url})${time ? ` *${time}*` : ""}\n`;

        // Write full article to individual file if content exists
        if (art.content) {
          const safeName = art.title.replace(/[\/\\:*?"<>|]/g, "_").substring(0, 60);
          const contentPath = join(dateDir, `${safeName}.md`);
          const fullMd =
            `# ${art.title}\n\n` +
            `**Source**: ${target.name}\n` +
            `**Time**: ${time || "Unknown"}\n` +
            `**Original Link**: ${url}\n\n` +
            `---\n\n${art.content}\n`;
          writeFileSync(contentPath, fullMd, "utf-8");
        }
      }
      summaryMd += "\n";
    }

    summaryMd += `---\n*${arts.length} articles total*`;
    const summaryPath = join(dateDir, `_summary.md`);
    writeFileSync(summaryPath, summaryMd, "utf-8");
    console.log(summaryMd);
    console.log(`Saved to: ${dateDir}/`);
  }

  closeDb();
}

main().catch((e) => {
  console.error(`Output failed: ${e.message}`);
  process.exit(1);
});
