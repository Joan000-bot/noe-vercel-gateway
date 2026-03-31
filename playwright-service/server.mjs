import http from "http";
import { chromium } from "playwright";
import fs from "fs";

const API_KEY = (() => { try { return fs.readFileSync("/root/playwright-key.txt", "utf-8").trim(); } catch { return "pw-noe-2026"; } })();
const X_USER = (() => { try { return fs.readFileSync("/root/x-username.txt", "utf-8").trim(); } catch { return ""; } })();
const X_PASS = (() => { try { return fs.readFileSync("/root/x-password.txt", "utf-8").trim(); } catch { return ""; } })();
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

  // /x/login - Login to X and save cookies
  if (req.url === "/x/login") {
    if (!X_USER || !X_PASS) { res.writeHead(400); return res.end(JSON.stringify({ error: "X credentials not configured" })); }
    var context, page;
    try {
      var b = await getBrowser();
      context = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US" });
      page = await context.newPage();

      await page.goto("https://x.com/i/flow/login", { waitUntil: "networkidle", timeout: 40000 });

      // Wait for the login form to render (X is heavy SPA)
      await page.waitForSelector('input', { timeout: 20000 });
      await page.waitForTimeout(2000);

      // Enter username - try multiple selectors
      var usernameInput = page.locator('input[name="text"], input[autocomplete="username"], input[type="text"]').first();
      await usernameInput.waitFor({ timeout: 10000 });
      await usernameInput.fill(X_USER);
      await page.waitForTimeout(1000);

      // Click Next
      var nextBtn = page.locator('button:has-text("Next"), button:has-text("下一步"), [role="button"]:has-text("Next")').first();
      await nextBtn.click();
      await page.waitForTimeout(3000);

      // Enter password
      var pwInput = page.locator('input[type="password"], input[name="password"]').first();
      await pwInput.waitFor({ timeout: 10000 });
      await pwInput.fill(X_PASS);
      await page.waitForTimeout(1000);

      // Click Log in
      var loginBtn = page.locator('button:has-text("Log in"), button:has-text("登录"), [data-testid="LoginForm_Login_Button"]').first();
      await loginBtn.click();
      await page.waitForTimeout(6000);

      // Check if logged in
      var currentUrl = page.url();
      if (currentUrl.includes("/home") || !currentUrl.includes("/login")) {
        // Save cookies
        var cookies = await context.cookies();
        fs.writeFileSync(X_COOKIES_FILE, JSON.stringify(cookies, null, 2));
        res.end(JSON.stringify({ success: true, message: "Logged in and cookies saved", url: currentUrl }));
      } else {
        // Might need additional verification
        var pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "");
        res.end(JSON.stringify({ success: false, message: "Login may need verification", url: currentUrl, pageText }));
      }
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message }));
    } finally {
      if (context) await context.close().catch(() => {});
    }
    return;
  }

  // /x/timeline - Read X timeline with saved cookies
  if (req.url === "/x/timeline") {
    var username = body.username || "";
    var context, page;
    try {
      // Load cookies from files or saved session
      var cookies = [];
      if (X_AUTH && X_CT0) {
        cookies = [
          { name: "auth_token", value: X_AUTH, domain: ".x.com", path: "/", httpOnly: true, secure: true, sameSite: "None" },
          { name: "ct0", value: X_CT0, domain: ".x.com", path: "/", secure: true, sameSite: "Lax" }
        ];
      } else {
        try { cookies = JSON.parse(fs.readFileSync(X_COOKIES_FILE, "utf-8")); } catch {}
      }
      if (!cookies.length) { return res.end(JSON.stringify({ success: false, error: "No X cookies configured." })); }

      var b = await getBrowser();
      context = await b.newContext({ viewport: { width: 1280, height: 720 }, locale: "zh-CN" });
      await context.addCookies(cookies);
      page = await context.newPage();

      var targetUrl = username ? "https://x.com/" + username : "https://x.com/home";
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(4000);

      // Scroll to load tweets
      await page.evaluate(async () => { for (var i = 0; i < 2; i++) { window.scrollBy(0, window.innerHeight); await new Promise(r => setTimeout(r, 1500)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(1000);

      // Extract tweets
      var tweets = await page.evaluate(() => {
        var articles = document.querySelectorAll('article[data-testid="tweet"]');
        return Array.from(articles).slice(0, 10).map(a => {
          var nameEl = a.querySelector('[data-testid="User-Name"]');
          var textEl = a.querySelector('[data-testid="tweetText"]');
          var timeEl = a.querySelector('time');
          var links = a.querySelectorAll('a[href*="/status/"]');
          var tweetLink = "";
          for (var l of links) { if (l.href.match(/\/status\/\d+$/)) { tweetLink = l.href; break; } }
          return {
            author: nameEl ? nameEl.innerText.replace(/\n/g, " ") : "",
            text: textEl ? textEl.innerText : "",
            time: timeEl ? timeEl.getAttribute("datetime") : "",
            url: tweetLink
          };
        }).filter(t => t.text);
      });

      // Update cookies in case they refreshed
      var newCookies = await context.cookies();
      fs.writeFileSync(X_COOKIES_FILE, JSON.stringify(newCookies, null, 2));

      res.end(JSON.stringify({ success: true, data: { tweets, url: targetUrl, count: tweets.length } }));
    } catch (e) {
      res.writeHead(500); res.end(JSON.stringify({ success: false, error: e.message }));
    } finally {
      if (context) await context.close().catch(() => {});
    }
    return;
  }

  res.writeHead(404); res.end(JSON.stringify({ error: "Not found" }));

}).listen(PORT, "127.0.0.1", () => console.log("Playwright service on port " + PORT));

process.on("SIGTERM", async () => { if (browser) await browser.close(); process.exit(0); });
