const fs = require("fs");
const puppeteer = require("puppeteer");

let browser = null;

// Puppeteer butuh Chrome/Chromium. Di container Dockerfile sudah di-install
// (`npx puppeteer browsers install chrome`), tapi kalau backend dijalankan
// langsung di mesin dev (node server.js) cache-nya belum ada sehingga
// launch() gagal dengan "Could not find Chrome". Fallback: pakai Chrome/
// Edge yang sudah terpasang di sistem, atau path dari environment variable.
const SYSTEM_BROWSER_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  // Windows
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  // Linux / Docker
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function resolveExecutablePath() {
  try {
    const bundled = puppeteer.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (_) {
    // abaikan, lanjut ke kandidat sistem
  }
  return SYSTEM_BROWSER_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    const executablePath = resolveExecutablePath();
    browser = await puppeteer.launch({
      headless: 'new',
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// Batasi jumlah page Puppeteer yang render bersamaan. Tanpa ini, batch print
// (mis. 10 label sekaligus dari tablet) membuka 10 page/tab Chromium secara
// paralel di satu proses browser — CPU/memory thrash sampai `page.setContent`
// melebihi navigation timeout 30s (lihat AGENTS.md riwayat bug).
const MAX_CONCURRENT_PAGES = 3;
let activePages = 0;
const waitQueue = [];

function acquirePageSlot() {
  if (activePages < MAX_CONCURRENT_PAGES) {
    activePages++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitQueue.push(resolve));
}

function releasePageSlot() {
  const next = waitQueue.shift();
  if (next) {
    next();
  } else {
    activePages = Math.max(0, activePages - 1);
  }
}

module.exports = { getBrowser, closeBrowser, acquirePageSlot, releasePageSlot };
