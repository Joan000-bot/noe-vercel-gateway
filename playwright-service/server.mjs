import http from "http";
import { chromium } from "playwright";
import fs from "fs";

const API_KEY = (() => { try { return fs.readFileSync("/root/playwright-key.txt", "utf-8").trim(); } catch { return "pw-noe-2026"; } })();
const PORT = 3100;

let browser = null;
let lastUsed = 0;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  }
  lastUsed = Date.now();
  return browser;
}

// Auto-close browser after 5 min idle to save memory
setInterval(async () => { if (browser && Date.now() - lastUsed > 300000) { await browser.close().catch(() => {}); browser = null; console.log("Browser closed (idle)"); } }, 60000);

function readBody(req) { return new Promise(r => { var d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); }); }

http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");

  // Auth
  var auth = (req.headers.authorization || "").replace("Bearer ", "");
  if (req.url !== "/health" && auth !== API_KEY) { res.writeHead(401); return res.end(JSON.stringify({ error: "Unauthorized" })); }

  // Health
  if (req.url === "/health") { return res.end(JSON.stringify({ status: "ok", browser: browser?.isConnected() ?? false })); }

  // Rate limit (simple: max 1 concurrent)
  if (req.method !== "POST") { res.writeHead(405); return res.end(JSON.stringify({ error: "POST only" })); }

  var body;
  try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400); return res.end(JSON.stringify({ error: "Bad JSON" })); }

  // /browse
  if (req.url === "/browse") {
    var { url, action = "read", selector, screenshot = false, scroll = false } = body;
    if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: "URL required" })); }

    var context, page;
    try {
      var b = await getBrowser();
      context = await b.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        viewport: { width: 1280, height: 720 }, locale: "zh-CN"
      });
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);

      if (scroll) {
        await page.evaluate(async () => { for (var i = 0; i < 3; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 1000)); } window.scrollTo(0, 0); });
      }

      var result = { url };

      if (action === "read") {
        result.title = await page.title();
        result.content = await page.evaluate(() => {
          ["script", "style", "nav", "footer", "header", "aside", ".ad"].forEach(s => document.querySelectorAll(s).forEach(e => e.remove()));
          return (document.body?.innerText || "").substring(0, 15000);
        });
        result.links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).slice(0, 15).map(a => ({ text: a.innerText.trim().substring(0, 80), href: a.href })).filter(l => l.text && l.href.startsWith("http")));
      }

      if (action === "extract" && selector) {
        result.elements = await page.evaluate(s => Array.from(document.querySelectorAll(s)).slice(0, 15).map(e => ({ text: e.innerText.trim().substring(0, 1000) })), selector);
      }

      if (screenshot) {
        var buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
        result.screenshot = buf.toString("base64");
      }

      result.meta = await page.evaluate(() => {
        var g = n => { var e = document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]'); return e ? e.getAttribute("content") : null; };
        return { description: g("description") || g("og:description"), image: g("og:image"), author: g("author") };
      });

      res.end(JSON.stringify({ success: true, data: result }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message, url }));
    } finally {
      if (context) await context.close().catch(() => {});
    }
    return;
  }

  // /browse/tweet
  if (req.url === "/browse/tweet") {
    var { url } = body;
    if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: "URL required" })); }

    var tweetId = url.match(/status\/(\d+)/)?.[1];
    if (tweetId) {
      // Try fxtwitter API first
      try {
        var r = await fetch("https://api.fxtwitter.com/status/" + tweetId);
        var data = await r.json();
        if (data.tweet) {
          return res.end(JSON.stringify({ success: true, data: { tweet: data.tweet.text, author: data.tweet.author?.name, handle: data.tweet.author?.screen_name, likes: data.tweet.likes, retweets: data.tweet.retweets, created_at: data.tweet.created_at, url } }));
        }
      } catch {}
    }

    // Fallback: browse the page
    var context, page;
    try {
      var b = await getBrowser();
      context = await b.newContext({ viewport: { width: 1280, height: 720 } });
      page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
      var content = await page.evaluate(() => (document.body?.innerText || "").substring(0, 10000));
      res.end(JSON.stringify({ success: true, data: { content, url } }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message, url }));
    } finally {
      if (context) await context.close().catch(() => {});
    }
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: "Not found" }));

}).listen(PORT, "127.0.0.1", () => console.log("Playwright service on port " + PORT));

process.on("SIGTERM", async () => { if (browser) await browser.close(); process.exit(0); });
