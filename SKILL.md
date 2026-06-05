---
name: weixin-article-collector-full
description: Use when needing a complete, runnable Node.js project to automatically collect daily articles from WeChat public accounts (微信公众号) via the WeRead API proxy, with full source code included.
---

# 微信公众号文章搜集器（完整代码版）

## 概述

一个完整的、自包含的 Node.js 项目，用于通过微信读书（WeRead）API 代理自动搜集关注的微信公众号每日文章。包含所有源代码文件、配置和文档，开箱即用。

**核心原则：** 不要正面硬刚微信的封闭生态，而是在生态内找到合法的旁路（微信读书），而非逆向工程破解反爬机制。

## 适用场景

- 需要一个**开箱即用的完整解决方案**，所有代码可直接运行
- 想要**自定义**搜集逻辑、输出格式或数据策略
- 需要在运行前**审计**完整实现
- 想要**Fork 并扩展**项目以满足自身需求

**不适用场景：**
- 只想了解高层思路（请使用 `weixin-article-collector`）
- 无法在本地运行 Node.js v25+

## 快速开始

```bash
# 1. 将 skill 文件复制到项目目录
cp -r ~/.claude/skills/weixin-article-collector-full/* ./my-scraper/
cd my-scraper

# 2. 安装依赖
npm install

# 3. 登录（终端扫码）
npm run login

# 4. 添加目标公众号（一次性设置）
npm run setup -- --add "公众号名" "https://mp.weixin.qq.com/s/xxxxx"

# 5. 每日运行
npm run run
```

## 项目结构

```
weixin-scraper/
├── package.json           # 依赖：cheerio、qrcode-terminal
├── config.js              # 目标公众号配置
├── RULES.md               # 搜集规则文档
├── src/
│   ├── db.js              # SQLite 初始化、CRUD 操作
│   ├── login.js           # 扫码登录 + token 管理
│   ├── sync.js            # 文章同步核心逻辑（增量+正文抓取+自动清理）
│   ├── output.js          # 按日期输出 Markdown
│   ├── fetch-content.js   # 独立正文补抓工具
│   └── weread-api.js      # 微信读书 API 封装（含重试）
├── data/
│   ├── accounts.json      # 公众号配置（mpId 等）
│   └── weixin.db          # SQLite 数据库文件
├── auth.json              # 登录凭证（vid + token）
└── output/                # 输出目录
    └── YYYY-MM-DD/
        ├── _汇总.md        # 当日文章清单
        └── 文章标题.md     # 单篇全文
```

## 文件说明

### `package.json`

```json
{
  "name": "weixin-scraper",
  "version": "1.0.0",
  "description": "Lightweight WeChat public account article scraper via WeRead API",
  "type": "module",
  "scripts": {
    "login": "node --experimental-sqlite src/login.js",
    "setup": "node --experimental-sqlite src/sync.js --setup",
    "sync": "node --experimental-sqlite src/sync.js",
    "output": "node --experimental-sqlite src/output.js",
    "run": "node --experimental-sqlite src/sync.js && node --experimental-sqlite src/output.js",
    "fetch-content": "node --experimental-sqlite src/fetch-content.js"
  },
  "dependencies": {
    "cheerio": "^1.2.0",
    "qrcode-terminal": "^0.12.0"
  }
}
```

### `config.js`

在此配置目标公众号：

```javascript
export const TARGET_ACCOUNTS = [
  { name: "公众号A" },
  { name: "公众号B" },
  { name: "公众号C" },
];
```

### `src/weread-api.js`

微信读书代理的 API 封装。关键特性：
- 自动注入认证请求头（`xid` + `Authorization: Bearer <token>`）
- `getArticlesAllPages()` 内置重试逻辑（最多 5 次，间隔 400ms），用于处理间歇性空响应

### `src/db.js`

使用 Node.js 内置 `node:sqlite`（`DatabaseSync`）的 SQLite 层。

**Schema：**
```sql
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  intro       TEXT DEFAULT '',
  cover       TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE articles (
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
);

CREATE INDEX idx_articles_account_date
  ON articles(account_id, publish_at);
```

### `src/sync.js`

核心同步逻辑，包含四种模式：

1. **设置模式**（`--setup`）：通过 `wxs2mp` API 添加公众号
2. **同步模式**（默认）：增量同步昨天+今天的文章
3. **正文抓取**：自动为新文章抓取完整正文
4. **自动清理**：每个公众号仅保留最新 20 篇文章

### `src/output.js`

按日期生成输出：
- `_汇总.md` —— 按公众号分组的当日文章清单
- 独立 `.md` 文件 —— 含元数据的完整文章内容

### `src/login.js`

在终端中渲染 ASCII 二维码，供微信扫码登录。将 `vid` + `token` 保存到 `auth.json`。

### `src/fetch-content.js`

独立工具，用于重新抓取数据库中缺少正文的文章。适用于 schema 变更或提取方法更新后的回填。

## 正文提取策略

微信文章页面使用 JavaScript 动态渲染。仅依赖静态 DOM 解析是不够的。

**主要方法：** 从页面源码中的 `content_noencode` JS 变量提取：
```javascript
const noencodeMatch = html.match(/content_noencode:\s*'([^']*)'/);
if (noencodeMatch) {
  const raw = noencodeMatch[1];
  return raw.replace(/\\x0a/g, "\n").replace(/\\x22/g, '"').trim();
}
```

**回退方案：** 旧格式文章使用 `#js_content` DOM 元素（通过 cheerio）。

## 数据策略

### 底量内容（自动维护）
- 每个公众号保留最新 **20 篇文章**（含正文）
- 每次同步后自动清理旧文章

### 增量更新
- 每次运行只抓取**昨天和今天**的文章
- 新文章自动去重并存储
- 正文抓取间隔：800ms/篇，避免触发反爬

## 日常使用流程

```bash
# 首次使用
npm run login   # 终端扫码登录微信读书
npm run setup -- --add "公众号名" "https://mp.weixin.qq.com/s/..."

# 日常使用
npm run run     # 一条命令：同步 + 输出
```

## 常见坑点

| 坑点 | 解法 |
|------|------|
| 二维码链接无法使用 | 通过 `qrcode-terminal` 在终端中渲染 ASCII 二维码 |
| API 随机返回空数组 | 最多重试 5 次，每次间隔 400ms |
| 文章正文"为空" | 优先从 `content_noencode` JS 变量提取，回退到 `#js_content` |
| Token 过期（约 1-2 小时） | 重新运行 `npm run login` 刷新 |

## 关键经验

1. **封闭系统的旁路思维：** 不要硬刚平台，在生态内找到合法的访问渠道。
2. **重试即基础设施：** 第三方代理服务不稳定，重试逻辑是必需的，不是可选的。
3. **工具链要匹配规模：** 不需要 Docker，不需要 MySQL。Node.js 内置能力已足够。
4. **规则文档化：** 把搜集规则写入 `RULES.md`，让 Agent 指令引用文档而非硬编码逻辑。

## 预估值

| 项目 | 数值 |
|------|------|
| 公众号数量 | ~7 个 |
| 每号保留文章 | 20 篇（底量） |
| 数据库总量 | ~140 篇（含正文） |
| 日常增量 | 昨天+今天，通常 10-30 篇 |
| 单次运行时间 | ~30 秒（无新文章）～ 2 分钟（有新增+抓正文） |
| 磁盘占用 | SQLite ~25MB + output 目录 |

## 自定义扩展点

- **`config.js`**：添加/移除目标公众号
- **`src/sync.js`**：修改 `getTodayRange()` 以调整同步窗口（默认：昨天+今天）
- **`src/sync.js`**：修改 `pruneOldArticles()` 以调整保留上限（默认：每号 20 篇）
- **`src/output.js`**：自定义 Markdown 输出格式
- **`src/fetch-content.js`**：调整抓取间隔（默认：800ms）或添加代理支持
