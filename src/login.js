import { initiateLogin, pollLogin } from "./weread-api.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import qrcode from "qrcode-terminal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_PATH = join(__dirname, "..", "auth.json");

function loadAuth() {
  if (existsSync(AUTH_PATH)) {
    try {
      return JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function saveAuth(vid, token, username) {
  writeFileSync(
    AUTH_PATH,
    JSON.stringify({ vid, token, username, savedAt: new Date().toISOString() }, null, 2)
  );
}

async function doLogin() {
  console.log("Connecting to WeRead...");
  const { uuid, scanUrl } = await initiateLogin();

  console.log("\nPlease scan the QR code below with WeChat:\n");
  qrcode.generate(scanUrl, { small: true });

  console.log("\nScan instructions:");
  console.log("  1. Open WeChat → Scan");
  console.log("  2. Point camera at the QR code in terminal");
  console.log("  3. Tap 'Confirm Login' on your phone");
  console.log("\nWaiting for scan confirmation (max 120s)...\n");

  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const result = await pollLogin(uuid);
      if (result.message === "success") {
        console.log(`Login successful! User: ${result.username}`);
        saveAuth(result.vid, result.token, result.username);
        return { vid: result.vid, token: result.token, username: result.username };
      }
      if (i % 5 === 0) {
        process.stdout.write(".");
      }
    } catch (e) {
      if (i % 5 === 0) {
        process.stdout.write(".");
      }
    }
  }

  throw new Error("Login timeout, please retry");
}

async function main() {
  const existing = loadAuth();
  if (existing) {
    console.log(`Found cached login info (${existing.savedAt})`);
    console.log(`User: ${existing.username}`);
    console.log("To re-login, delete auth.json and retry.");
    return;
  }

  try {
    await doLogin();
    console.log("\nLogin credentials saved to auth.json");
  } catch (e) {
    console.error(`\nLogin failed: ${e.message}`);
    process.exit(1);
  }
}

main();
