import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "data", "weixin.db");

let db;

export function getDb() {
  if (!db) {
    const dataDir = dirname(DB_PATH);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      intro       TEXT DEFAULT '',
      cover       TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id          TEXT PRIMARY KEY,
      account_id  TEXT NOT NULL,
      title       TEXT NOT NULL,
      url         TEXT DEFAULT '',
      pic_url     TEXT DEFAULT '',
      summary     TEXT DEFAULT '',
      content     TEXT DEFAULT '',
      html_content TEXT DEFAULT '',
      publish_at  INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )
  `);

  // Migration: add columns if upgrading from older schema
  try { db.exec("ALTER TABLE articles ADD COLUMN content TEXT DEFAULT ''"); } catch {}
  try { db.exec("ALTER TABLE articles ADD COLUMN html_content TEXT DEFAULT ''"); } catch {}

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_articles_account_date
      ON articles(account_id, publish_at)
  `);
}

export function upsertAccount(id, name, intro = "", cover = "") {
  const stmt = getDb().prepare(`
    INSERT INTO accounts (id, name, intro, cover)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, intro=excluded.intro, cover=excluded.cover
  `);
  stmt.run(id, name, intro, cover);
}

export function getAccount(id) {
  return getDb().prepare("SELECT * FROM accounts WHERE id = ?").get(id);
}

export function getAllAccounts() {
  return getDb().prepare("SELECT * FROM accounts ORDER BY name").all();
}

export function upsertArticle(id, accountId, title, url, picUrl, publishAt) {
  const stmt = getDb().prepare(`
    INSERT INTO articles (id, account_id, title, url, pic_url, publish_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title=excluded.title, url=excluded.url, pic_url=excluded.pic_url, publish_at=excluded.publish_at
  `);
  stmt.run(id, accountId, title, url, picUrl, publishAt);
}

export function updateArticleContent(id, content, htmlContent) {
  const stmt = getDb().prepare(`
    UPDATE articles SET content = ?, html_content = ? WHERE id = ?
  `);
  stmt.run(content, htmlContent, id);
}

export function getArticlesWithoutContent(limit = 100) {
  return getDb()
    .prepare(
      "SELECT id, url FROM articles WHERE content = '' OR content IS NULL ORDER BY publish_at DESC LIMIT ?"
    )
    .all(limit);
}

export function getArticlesByDate(accountId, startTs, endTs) {
  return getDb()
    .prepare(
      `SELECT * FROM articles WHERE account_id = ? AND publish_at >= ? AND publish_at < ? ORDER BY publish_at DESC`
    )
    .all(accountId, startTs, endTs);
}

export function getArticlesByAccount(accountId, limit = 10) {
  return getDb()
    .prepare(
      `SELECT * FROM articles WHERE account_id = ? ORDER BY publish_at DESC LIMIT ?`
    )
    .all(accountId, limit);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
