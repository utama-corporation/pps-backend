const puppeteer = require('puppeteer');

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await puppeteer.launch({
      headless: 'new',
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
