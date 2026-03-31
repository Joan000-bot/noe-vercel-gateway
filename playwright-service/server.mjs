import http from "http";
import { chromium } from "playwright";
import fs from "fs";

const API_KEY = (() => { try { return fs.readFileSync("/root/playwright-key.txt", "utf-8").trim(); } catch { return "pw-noe-2026"; } })();
const X_AUTH = (() => { try { return fs.readFileSync("/root/x-auth-token.txt", "utf-8").trim(); } catch { return ""; } })();
const X_CT0 = (() => { try { return fs.readFileSync("/root/x-ct0.txt", "utf-8").trim(); } catch { return ""; } })();
const X_COOKIES_FILE = "/root/x-cookies.json";
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

setInterval(async () => { if (browser && Date.now() - lastUsed > 300000) { await browser.close().catch(() => {}); browser = null; } }, 60000);

function readBody(req) { return new Promise(r => { var d = ""; req.on("data", c => d += c); req.on("end", () => r(d)); }); }

// === Multi-platform cookie injection ===
function loadCookieFile(name) { try { return fs.readFileSync("/root/" + name, "utf-8").trim(); } catch { return ""; } }

function parseCookieString(str, domain) {
  if (!str) return [];
  return str.split(";").map(s => s.trim()).filter(Boolean).map(pair => {
    var [name, ...rest] = pair.split("=");
    if (!name || !rest.length) return null;
    return { name: name.trim(), value: rest.join("=").trim(), domain: domain, path: "/", secure: true, sameSite: "None" };
  }).filter(Boolean);
}

function getCookiesForUrl(url) {
  var cookies = [];
  // X/Twitter
  if (url.includes("x.com") || url.includes("twitter.com")) {
    try { cookies = JSON.parse(fs.readFileSync(X_COOKIES_FILE, "utf-8")); } catch {}
    if (!cookies.length && X_AUTH && X_CT0) {
      cookies = [
        { name: "auth_token", value: X_AUTH, domain: ".x.com", path: "/", httpOnly: true, secure: true, sameSite: "None" },
        { name: "ct0", value: X_CT0, domain: ".x.com", path: "/", secure: true, sameSite: "Lax" }
      ];
    }
  }
  // Weibo
  if (url.includes("weibo.com") || url.includes("weibo.cn")) {
    cookies = parseCookieString(loadCookieFile("weibo-cookies.txt"), ".weibo.com");
  }
  // Xiaohongshu
  if (url.includes("xiaohongshu.com") || url.includes("xhslink.com")) {
    cookies = parseCookieString(loadCookieFile("xhs-cookies.txt"), ".xiaohongshu.com");
  }
  // Meituan
  if (url.includes("meituan.com")) {
    cookies = parseCookieString(loadCookieFile("meituan-cookies.txt"), ".meituan.com");
  }
  return cookies;
}

// === Create context with anti-detection ===
async function createContext(url, mobile) {
  var b = await getBrowser();
  var opts = mobile ? {
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    viewport: { width: 375, height: 812 }, locale: "zh-CN", timezoneId: "Asia/Shanghai"
  } : {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 }, locale: "zh-CN", timezoneId: "Asia/Shanghai"
  };
  var context = await b.newContext(opts);
  // Anti webdriver detection
  await context.addInitScript(() => { Object.defineProperty(navigator, "webdriver", { get: () => undefined }); });
  // Inject cookies
  var cookies = getCookiesForUrl(url || "");
  if (cookies.length) await context.addCookies(cookies);
  return context;
}

// === Helpers ===
async function smartScroll(page, targetCount, maxScrolls) {
  maxScrolls = maxScrolls || 30;
  for (var i = 0; i < maxScrolls; i++) {
    var cur = await page.evaluate(() => document.querySelectorAll("article, .wbpro-feed, .note-item, .feeds-container .item").length);
    if (cur >= targetCount) break;
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(2000);
    var now = await page.evaluate(() => document.querySelectorAll("article, .wbpro-feed, .note-item, .feeds-container .item").length);
    if (now === cur && i > 3) break;
  }
}

// === SERVER ===
http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  var auth = (req.headers.authorization || "").replace("Bearer ", "");
  if (req.url !== "/health" && auth !== API_KEY) { res.writeHead(401); return res.end(JSON.stringify({ error: "Unauthorized" })); }
  if (req.url === "/health") { return res.end(JSON.stringify({ status: "ok", browser: browser?.isConnected() ?? false })); }
  if (req.method !== "POST") { res.writeHead(405); return res.end(JSON.stringify({ error: "POST only" })); }

  var body;
  try { body = JSON.parse(await readBody(req)); } catch { res.writeHead(400); return res.end(JSON.stringify({ error: "Bad JSON" })); }

  // ==================== BROWSE WEB ====================
  if (req.url === "/browse") {
    var { url, action = "read", selector, screenshot = false, scroll = false } = body;
    if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: "URL required" })); }
    var context, page;
    try {
      var isMobile = url.includes("m.weibo") || url.includes("h5.waimai") || url.includes("xiaohongshu");
      context = await createContext(url, isMobile);
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2000);
      if (scroll) { await page.evaluate(async () => { for (var i = 0; i < 3; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 1000)); } window.scrollTo(0, 0); }); }
      var result = { url };
      if (action === "read") {
        result.title = await page.title();
        result.content = await page.evaluate(() => { ["script", "style", "nav", "footer", "aside", ".ad"].forEach(s => document.querySelectorAll(s).forEach(e => e.remove())); return (document.body?.innerText || "").substring(0, 15000); });
        result.links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).slice(0, 15).map(a => ({ text: a.innerText.trim().substring(0, 80), href: a.href })).filter(l => l.text && l.href.startsWith("http")));
      }
      if (action === "extract" && selector) {
        result.elements = await page.evaluate(s => Array.from(document.querySelectorAll(s)).slice(0, 15).map(e => ({ text: e.innerText.trim().substring(0, 1000) })), selector);
      }
      if (screenshot) { var buf = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false }); result.screenshot = buf.toString("base64"); }
      result.meta = await page.evaluate(() => { var g = n => { var e = document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]'); return e ? e.getAttribute("content") : null; }; return { description: g("description") || g("og:description"), image: g("og:image") }; });
      res.end(JSON.stringify({ success: true, data: result }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message, url })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  // ==================== X/TWITTER ====================
  if (req.url === "/browse/tweet") {
    var { url } = body;
    if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: "URL required" })); }
    var tweetId = url.match(/status\/(\d+)/)?.[1];
    if (tweetId) { try { var r = await fetch("https://api.fxtwitter.com/status/" + tweetId); var data = await r.json(); if (data.tweet) return res.end(JSON.stringify({ success: true, data: { tweet: data.tweet.text, author: data.tweet.author?.name, handle: data.tweet.author?.screen_name, likes: data.tweet.likes, retweets: data.tweet.retweets, created_at: data.tweet.created_at, url } })); } catch {} }
    var context, page;
    try { context = await createContext(url); page = await context.newPage(); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.waitForTimeout(3000);
      var content = await page.evaluate(() => (document.body?.innerText || "").substring(0, 10000)); res.end(JSON.stringify({ success: true, data: { content, url } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message, url })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  if (req.url === "/x/timeline") {
    var username = body.username || "", count = Math.min(body.count || 10, 100);
    var context, page;
    try {
      context = await createContext("https://x.com");
      page = await context.newPage();
      var targetUrl = username ? "https://x.com/" + username : "https://x.com/home";
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(4000);
      for (var _s = 0; _s < 30; _s++) {
        var _cur = await page.evaluate(() => document.querySelectorAll('article[data-testid="tweet"]').length);
        if (_cur >= count) break;
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
        await page.waitForTimeout(2000);
        var _new = await page.evaluate(() => document.querySelectorAll('article[data-testid="tweet"]').length);
        if (_new === _cur && _s > 3) break;
      }
      var tweets = await page.evaluate((max) => {
        return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, max).map(a => {
          var nameEl = a.querySelector('[data-testid="User-Name"]'), textEl = a.querySelector('[data-testid="tweetText"]'), timeEl = a.querySelector("time");
          var tweetLink = ""; for (var l of a.querySelectorAll('a[href*="/status/"]')) { if (l.href.match(/\/status\/\d+$/)) { tweetLink = l.href; break; } }
          return { author: nameEl ? nameEl.innerText.replace(/\n/g, " ") : "", text: textEl ? textEl.innerText : "", time: timeEl ? timeEl.getAttribute("datetime") : "", url: tweetLink };
        }).filter(t => t.text);
      }, count);
      var nc = await context.cookies(); fs.writeFileSync(X_COOKIES_FILE, JSON.stringify(nc, null, 2));
      res.end(JSON.stringify({ success: true, data: { tweets, url: targetUrl, count: tweets.length } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  if (req.url === "/x/post") {
    try { var r = await fetch("http://127.0.0.1:3101", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer noe-exec-2026-secret" }, body: JSON.stringify(body) });
      var data = await r.json(); res.end(JSON.stringify(data));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    return;
  }

  // ==================== WEIBO ====================
  if (req.url === "/weibo/timeline") {
    var username = body.username || "", count = Math.min(body.count || 10, 50);
    var context, page;
    try {
      context = await createContext("https://m.weibo.cn", true);
      page = await context.newPage();
      var targetUrl = username ? "https://m.weibo.cn/u/" + username : "https://m.weibo.cn/feed/friends";
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);
      await smartScroll(page, count);
      var posts = await page.evaluate(() => {
        return (document.body?.innerText || "").substring(0, 15000);
      });
      res.end(JSON.stringify({ success: true, data: { content: posts, url: targetUrl } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  if (req.url === "/weibo/post") {
    var { text } = body;
    if (!text) { res.writeHead(400); return res.end(JSON.stringify({ error: "text required" })); }
    var context, page;
    try {
      context = await createContext("https://m.weibo.cn", true);
      page = await context.newPage();
      await page.goto("https://m.weibo.cn/compose/", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);
      var editor = page.locator("textarea, [contenteditable]").first();
      await editor.waitFor({ timeout: 10000 });
      await editor.fill(text);
      await page.waitForTimeout(1000);
      var sendBtn = page.locator('a:has-text("发送"), button:has-text("发送"), [node-type="submit"]').first();
      await sendBtn.click();
      await page.waitForTimeout(3000);
      res.end(JSON.stringify({ success: true, message: "微博已发送" }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  if (req.url === "/weibo/read") {
    var { url } = body;
    if (!url) { res.writeHead(400); return res.end(JSON.stringify({ error: "url required" })); }
    var context, page;
    try {
      context = await createContext(url, true);
      page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
      var content = await page.evaluate(() => (document.body?.innerText || "").substring(0, 15000));
      res.end(JSON.stringify({ success: true, data: { content, url } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  // ==================== XIAOHONGSHU ====================
  if (req.url === "/xhs/search") {
    var { query, note_url } = body;
    var context, page;
    try {
      var url = note_url || (query ? "https://www.xiaohongshu.com/search_result?keyword=" + encodeURIComponent(query) : "https://www.xiaohongshu.com");
      context = await createContext(url);
      page = await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);
      if (!note_url) await smartScroll(page, 10, 5);
      var content = await page.evaluate(() => { ["script", "style"].forEach(s => document.querySelectorAll(s).forEach(e => e.remove())); return (document.body?.innerText || "").substring(0, 15000); });
      res.end(JSON.stringify({ success: true, data: { content, url } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  if (req.url === "/xhs/profile") {
    var { user_url } = body;
    if (!user_url) { res.writeHead(400); return res.end(JSON.stringify({ error: "user_url required" })); }
    var context, page;
    try {
      context = await createContext(user_url);
      page = await context.newPage();
      await page.goto(user_url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);
      var content = await page.evaluate(() => (document.body?.innerText || "").substring(0, 15000));
      res.end(JSON.stringify({ success: true, data: { content, url: user_url } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  // ==================== MEITUAN ====================
  if (req.url === "/meituan/search") {
    var { query } = body;
    if (!query) { res.writeHead(400); return res.end(JSON.stringify({ error: "query required" })); }
    var context, page;
    try {
      context = await createContext("https://h5.waimai.meituan.com", true);
      page = await context.newPage();
      await page.goto("https://h5.waimai.meituan.com/waimai/mindex/home", { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);
      // Find and use search
      var searchInput = page.locator('input[type="search"], input[placeholder*="搜索"], .search-input').first();
      await searchInput.waitFor({ timeout: 10000 });
      await searchInput.fill(query);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(4000);
      var content = await page.evaluate(() => (document.body?.innerText || "").substring(0, 15000));
      res.end(JSON.stringify({ success: true, data: { content, query } }));
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message })); }
    finally { if (context) await context.close().catch(() => {}); }
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: "Not found" }));

}).listen(PORT, "127.0.0.1", () => console.log("Playwright service on port " + PORT));

process.on("SIGTERM", async () => { if (browser) await browser.close(); process.exit(0); });
