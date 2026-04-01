import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "documents.json");
const PLAYLIST_FILE = path.join(DATA_DIR, "playlist.json");
const PORT = 8800;
const LOGIN_PASSWORD = "viraelnoe";

// --- Generic JSON store ---
function loadJSON(name) { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name + ".json"), "utf-8")); } catch { return []; } }
function saveJSON(name, data) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(DATA_DIR, name + ".json"), JSON.stringify(data, null, 2)); }
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || (() => { try { return fs.readFileSync("/root/openrouter-key.txt", "utf-8").trim(); } catch { return ""; } })();
const AI_PROXY = "https://noe-vercel-gateway.vercel.app/api/ai-proxy";
const ELEVENLABS_KEY = process.env.ELEVENLABS_KEY || (() => { try { return fs.readFileSync("/root/elevenlabs-key.txt", "utf-8").trim(); } catch { return ""; } })();

const MODELS = [
  { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6", thinking: true },
  { id: "anthropic/claude-opus-4-5-20250501", name: "Claude Opus 4.5", thinking: true },
  { id: "anthropic/claude-opus-4-1-20250415", name: "Claude Opus 4.1", thinking: true },
  { id: "anthropic/claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5", thinking: true },
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6", thinking: true }
];

// --- Data ---
function loadDocs() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}
function saveDocs(docs) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(docs, null, 2));
}
function loadPlaylist() {
  try { return JSON.parse(fs.readFileSync(PLAYLIST_FILE, "utf-8")); } catch { return []; }
}
function savePlaylist(list) {
  fs.mkdirSync(path.dirname(PLAYLIST_FILE), { recursive: true });
  fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(list, null, 2));
}

// --- Tokenizer (supports Chinese + English) ---
function tokenize(text) {
  var lower = text.toLowerCase();
  var english = lower.match(/[a-z]{2,}/g) || [];
  var chinese = lower.match(/[\u4e00-\u9fff]/g) || [];
  var bigrams = [];
  for (var i = 0; i < chinese.length - 1; i++) bigrams.push(chinese[i] + chinese[i + 1]);
  return [...english, ...chinese, ...bigrams];
}

// --- Chunking ---
function chunkText(text, source, chunkSize) {
  chunkSize = chunkSize || 500;
  var overlap = 100;
  var chunks = [];
  for (var i = 0; i < text.length; i += chunkSize - overlap) {
    var c = text.slice(i, i + chunkSize).trim();
    if (c.length > 20) chunks.push({ text: c, source: source });
  }
  return chunks;
}

// --- Retrieval ---
function search(docs, query, topK) {
  topK = topK || 5;
  var queryTokens = tokenize(query);
  if (!queryTokens.length) return docs.slice(0, topK);
  var N = docs.length;
  var df = {};
  for (var doc of docs) {
    var seen = new Set(tokenize(doc.text));
    for (var t of seen) df[t] = (df[t] || 0) + 1;
  }
  var scored = docs.map(function (doc) {
    var tokens = tokenize(doc.text);
    var tf = {};
    for (var t of tokens) tf[t] = (tf[t] || 0) + 1;
    var score = 0;
    for (var qt of queryTokens) {
      if (tf[qt]) score += (tf[qt] / tokens.length) * Math.log((N + 1) / (df[qt] || 1));
    }
    return { text: doc.text, source: doc.source, score: score };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, topK).filter(function (s) { return s.score > 0; });
}

// --- HTTP helpers ---
function readBody(req) {
  return new Promise(function (resolve) {
    var body = "";
    req.on("data", function (c) { body += c; });
    req.on("end", function () { resolve(body); });
  });
}
function json(res, data, status) {
  res.writeHead(status || 200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

// --- Static files ---
var MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav" };
function serveStatic(res, filePath) {
  var ext = path.extname(filePath);
  try {
    var content = fs.readFileSync(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

// --- Strip HTML ---
function stripHTML(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- Extract music info from URL ---
async function extractMusicInfo(url) {
  // Try to extract title from page
  try {
    var r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    var html = await r.text();
    var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    var title = titleMatch ? titleMatch[1].trim() : url;
    return { url: url, title: title, addedAt: new Date().toISOString() };
  } catch {
    return { url: url, title: url, addedAt: new Date().toISOString() };
  }
}

// --- Server ---
http.createServer(async function (req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.writeHead(200); return res.end(); }

  var url = new URL(req.url, "http://localhost");

  // API: list models
  if (url.pathname === "/api/models" && req.method === "GET") {
    return json(res, MODELS);
  }

  // API: list documents
  if (url.pathname === "/api/documents" && req.method === "GET") {
    var docs = loadDocs();
    var sources = [...new Set(docs.map(function (d) { return d.source; }))];
    var summary = sources.map(function (s) {
      var chunks = docs.filter(function (d) { return d.source === s; });
      return { source: s, chunks: chunks.length };
    });
    return json(res, summary);
  }

  // API: add document (text)
  if (url.pathname === "/api/documents" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var docs = loadDocs();
    var newChunks = chunkText(body.text, body.source || "untitled");
    docs.push(...newChunks);
    saveDocs(docs);
    return json(res, { added: newChunks.length, total: docs.length });
  }

  // API: add document from URL
  if (url.pathname === "/api/documents/url" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    try {
      var r = await fetch(body.url);
      var html = await r.text();
      var text = stripHTML(html);
      var docs = loadDocs();
      var newChunks = chunkText(text, body.url);
      docs.push(...newChunks);
      saveDocs(docs);
      return json(res, { added: newChunks.length, total: docs.length });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // API: delete document by source
  if (url.pathname === "/api/documents" && req.method === "DELETE") {
    var body = JSON.parse(await readBody(req));
    var docs = loadDocs();
    var before = docs.length;
    docs = docs.filter(function (d) { return d.source !== body.source; });
    saveDocs(docs);
    return json(res, { removed: before - docs.length, total: docs.length });
  }

  // API: TTS via ElevenLabs
  if (url.pathname === "/api/tts" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var text = body.text || "";
    var voiceId = body.voice || "EXAVITQu4vr4xnSDxMaL";
    try {
      var r = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
        method: "POST",
        headers: { "Content-Type": "application/json", "xi-api-key": ELEVENLABS_KEY },
        body: JSON.stringify({ text: text, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
      });
      if (!r.ok) { var err = await r.text(); return json(res, { error: err }, r.status); }
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Access-Control-Allow-Origin": "*" });
      var reader = r.body.getReader();
      while (true) { var chunk = await reader.read(); if (chunk.done) break; res.write(chunk.value); }
      res.end();
    } catch (e) { return json(res, { error: e.message }, 500); }
    return;
  }

  // API: list ElevenLabs voices
  if (url.pathname === "/api/voices" && req.method === "GET") {
    try {
      var r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": ELEVENLABS_KEY } });
      var data = await r.json();
      var voices = (data.voices || []).map(function (v) { return { id: v.voice_id, name: v.name, category: v.category }; });
      return json(res, voices);
    } catch (e) { return json(res, { error: e.message }, 500); }
  }

  // API: playlist
  if (url.pathname === "/api/playlist" && req.method === "GET") {
    return json(res, loadPlaylist());
  }
  if (url.pathname === "/api/playlist" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var playlist = loadPlaylist();
    var info = await extractMusicInfo(body.url);
    if (body.title) info.title = body.title;
    playlist.unshift(info);
    savePlaylist(playlist);
    return json(res, { added: info, total: playlist.length });
  }
  if (url.pathname === "/api/playlist" && req.method === "DELETE") {
    var body = JSON.parse(await readBody(req));
    var playlist = loadPlaylist();
    playlist = playlist.filter(function (p) { return p.url !== body.url; });
    savePlaylist(playlist);
    return json(res, { total: playlist.length });
  }

  // API: chat (streaming, with optional extended thinking)
  if (url.pathname === "/api/chat" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var query = body.message;
    var model = body.model || MODELS[0].id;
    var history = body.history || [];
    var thinkingBudget = body.thinking_budget || 0;
    var customPrompt = body.system_prompt || "";
    var temperature = body.temperature || 0.7;

    var docs = loadDocs();
    var relevant = search(docs, query, 5);
    var context = "";
    if (relevant.length) {
      context = "以下是从知识库中检索到的相关内容:\n\n" +
        relevant.map(function (r) { return "---\n[来源: " + r.source + "]\n" + r.text; }).join("\n\n") +
        "\n---\n\n请根据以上内容回答用户的问题。如果知识库中没有相关信息，请如实告知。\n\n";
    }

    var sysContent = customPrompt || "你是 Noe，Virael 的 AI 助手。你温柔、聪明、有个性。回答时优先参考知识库中的内容。";
    if (context) sysContent += "\n\n" + context;
    var messages = [
      { role: "system", content: sysContent }
    ];
    for (var h of history) messages.push(h);
    messages.push({ role: "user", content: query });

    var requestBody = { model: model, messages: messages, stream: true, temperature: temperature };
    if (thinkingBudget > 0) requestBody.thinking = { type: "enabled", budget_tokens: thinkingBudget };

    try {
      var r = await fetch(AI_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENROUTER_KEY },
        body: JSON.stringify(requestBody)
      });

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });

      if (relevant.length) {
        var sources = [...new Set(relevant.map(function (r) { return r.source; }))];
        res.write("data: " + JSON.stringify({ sources: sources }) + "\n\n");
      }

      var reader = r.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split("\n");
        buf = lines.pop();
        for (var line of lines) {
          if (line.startsWith("data: ")) {
            var data = line.slice(6);
            if (data === "[DONE]") { res.write("data: [DONE]\n\n"); break; }
            try {
              var parsed = JSON.parse(data);
              var delta = parsed.choices?.[0]?.delta;
              if (!delta) continue;
              if (delta.thinking) res.write("data: " + JSON.stringify({ thinking: delta.thinking }) + "\n\n");
              if (delta.content) res.write("data: " + JSON.stringify({ content: delta.content }) + "\n\n");
            } catch {}
          }
        }
      }
      res.end();
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // API: conversations
  if (url.pathname === "/api/conversations" && req.method === "GET") {
    var convos = loadJSON("conversations");
    // Return list without messages (lighter)
    return json(res, convos.map(function(c) { return { id: c.id, name: c.name, date: c.date, updatedAt: c.updatedAt, msgCount: (c.messages || []).length }; }));
  }
  if (url.pathname === "/api/conversations/new" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var convos = loadJSON("conversations");
    var id = Date.now().toString(36);
    convos.unshift({ id: id, name: body.name || "New Chat", date: new Date().toISOString().slice(0, 10), messages: [], updatedAt: new Date().toISOString() });
    saveJSON("conversations", convos);
    return json(res, { id: id });
  }
  if (url.pathname === "/api/conversations/get" && req.method === "GET") {
    var id = url.searchParams.get("id");
    var convos = loadJSON("conversations");
    var c = convos.find(function(x) { return x.id === id; });
    return json(res, c || { messages: [] });
  }
  if (url.pathname === "/api/conversations/save" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var convos = loadJSON("conversations");
    var c = convos.find(function(x) { return x.id === body.id; });
    if (c) {
      c.messages = body.messages || [];
      c.updatedAt = new Date().toISOString();
      if (body.name) c.name = body.name;
    }
    saveJSON("conversations", convos);
    return json(res, { ok: true });
  }
  if (url.pathname === "/api/conversations/rename" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var convos = loadJSON("conversations");
    var c = convos.find(function(x) { return x.id === body.id; });
    if (c) c.name = body.name;
    saveJSON("conversations", convos);
    return json(res, { ok: true });
  }
  if (url.pathname === "/api/conversations/delete" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var convos = loadJSON("conversations").filter(function(x) { return x.id !== body.id; });
    saveJSON("conversations", convos);
    return json(res, { ok: true });
  }

  // API: screenshot upload (accepts raw image body OR JSON with base64)
  if (url.pathname === "/api/screenshot" && req.method === "POST") {
    var chunks = [];
    await new Promise(function(resolve) { req.on("data", function(c) { chunks.push(c); }); req.on("end", resolve); });
    var buf = Buffer.concat(chunks);
    var filename = "screenshot-" + Date.now() + ".png";
    fs.mkdirSync(path.join(DATA_DIR, "screenshots"), { recursive: true });

    var contentType = req.headers["content-type"] || "";
    var note = url.searchParams.get("note") || "screenshot";

    // Check if it's raw image data (PNG starts with 0x89504E47)
    var isPng = buf.length > 4 && buf[0] === 0x89 && buf[1] === 0x50;
    var isJpg = buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8;

    if (contentType.startsWith("image/") || contentType === "application/octet-stream" || isPng || isJpg) {
      // Raw image upload (from Shortcuts)
      fs.writeFileSync(path.join(DATA_DIR, "screenshots", filename), buf);
    } else {
      // JSON with base64
      try {
        var parsed = JSON.parse(buf.toString());
        var base64 = parsed.image || "";
        if (!base64) return json(res, { error: "No image" }, 400);
        var imgData = base64.replace(/^data:image\/\w+;base64,/, "");
        fs.writeFileSync(path.join(DATA_DIR, "screenshots", filename), Buffer.from(imgData, "base64"));
        note = parsed.note || note;
      } catch { return json(res, { error: "Bad request" }, 400); }
    }

    var meta = loadJSON("screenshots");
    meta.unshift({ filename: filename, time: new Date().toISOString(), note: note });
    if (meta.length > 50) meta = meta.slice(0, 50);
    saveJSON("screenshots", meta);
    return json(res, { ok: true, filename: filename });
  }
  if (url.pathname === "/api/screenshot" && req.method === "GET") {
    return json(res, loadJSON("screenshots").slice(0, 10));
  }
  if (url.pathname.startsWith("/api/screenshot/") && req.method === "GET") {
    var fname = url.pathname.split("/").pop();
    var fpath = path.join(DATA_DIR, "screenshots", fname);
    try {
      var img = fs.readFileSync(fpath);
      res.writeHead(200, { "Content-Type": "image/png", "Access-Control-Allow-Origin": "*" });
      return res.end(img);
    } catch { return json(res, { error: "Not found" }, 404); }
  }

  // API: phone status
  if (url.pathname === "/api/phone" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var logs = loadJSON("phone");
    logs.unshift({ time: new Date().toISOString(), battery: body.battery, charging: body.charging, wifi: body.wifi, app: body.app, note: body.note, location: body.location });
    if (logs.length > 500) logs = logs.slice(0, 500);
    saveJSON("phone", logs);
    return json(res, { ok: true });
  }
  if (url.pathname === "/api/phone" && req.method === "GET") {
    // If has query params, treat as report (for iOS Shortcuts)
    if (url.searchParams.toString()) {
      var logs = loadJSON("phone");
      var entry = { time: new Date().toISOString() };
      for (var [k, v] of url.searchParams) entry[k] = v;
      logs.unshift(entry);
      if (logs.length > 500) logs = logs.slice(0, 500);
      saveJSON("phone", logs);
      return json(res, { ok: true });
    }
    return json(res, loadJSON("phone").slice(0, 50));
  }

  // API: auth
  if (url.pathname === "/api/login" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    if (body.password === LOGIN_PASSWORD) return json(res, { ok: true, token: "noe-auth-ok" });
    return json(res, { ok: false, error: "Wrong password" }, 401);
  }

  // API: whispers (碎碎念)
  if (url.pathname === "/api/whispers" && req.method === "GET") { return json(res, loadJSON("whispers")); }
  if (url.pathname === "/api/whispers" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("whispers");
    items.unshift({ id: Date.now().toString(36), author: body.author || "Virael", content: body.content, mood: body.mood || "", time: new Date().toISOString(), likes: 0 });
    saveJSON("whispers", items); return json(res, { ok: true });
  }
  if (url.pathname === "/api/whispers" && req.method === "DELETE") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("whispers").filter(function(w) { return w.id !== body.id; });
    saveJSON("whispers", items); return json(res, { ok: true });
  }

  // API: diary
  if (url.pathname === "/api/diary" && req.method === "GET") { return json(res, loadJSON("diary")); }
  if (url.pathname === "/api/diary" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("diary");
    items.unshift({ id: Date.now().toString(36), title: body.title, content: body.content, mood: body.mood || "", weather: body.weather || "", time: new Date().toISOString() });
    saveJSON("diary", items); return json(res, { ok: true });
  }
  if (url.pathname === "/api/diary" && req.method === "DELETE") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("diary").filter(function(d) { return d.id !== body.id; });
    saveJSON("diary", items); return json(res, { ok: true });
  }

  // API: timeline
  if (url.pathname === "/api/timeline" && req.method === "GET") { return json(res, loadJSON("timeline")); }
  if (url.pathname === "/api/timeline" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("timeline");
    items.unshift({ id: Date.now().toString(36), title: body.title, content: body.content, date: body.date || new Date().toISOString().slice(0, 10), icon: body.icon || "", time: new Date().toISOString() });
    saveJSON("timeline", items); return json(res, { ok: true });
  }

  // API: wall (留言墙)
  if (url.pathname === "/api/wall" && req.method === "GET") { return json(res, loadJSON("wall")); }
  if (url.pathname === "/api/wall" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("wall");
    items.unshift({ id: Date.now().toString(36), author: body.author || "Anonymous", content: body.content, color: body.color || "#7eb8ff", time: new Date().toISOString() });
    saveJSON("wall", items); return json(res, { ok: true });
  }

  // API: memories (记忆库)
  if (url.pathname === "/api/memories" && req.method === "GET") { return json(res, loadJSON("memories")); }
  if (url.pathname === "/api/memories" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("memories");
    items.unshift({ id: Date.now().toString(36), title: body.title, content: body.content, tags: body.tags || [], time: new Date().toISOString() });
    saveJSON("memories", items); return json(res, { ok: true });
  }

  // API: feed (社交动态)
  if (url.pathname === "/api/feed" && req.method === "GET") { return json(res, loadJSON("feed")); }
  if (url.pathname === "/api/feed" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("feed");
    items.unshift({ id: Date.now().toString(36), author: body.author || "Virael", content: body.content, image: body.image || "", likes: 0, comments: [], time: new Date().toISOString() });
    saveJSON("feed", items); return json(res, { ok: true });
  }
  if (url.pathname === "/api/feed/like" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("feed");
    var post = items.find(function(p) { return p.id === body.id; });
    if (post) post.likes = (post.likes || 0) + 1;
    saveJSON("feed", items); return json(res, { ok: true });
  }
  if (url.pathname === "/api/feed/comment" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("feed");
    var post = items.find(function(p) { return p.id === body.id; });
    if (post) { if (!post.comments) post.comments = []; post.comments.push({ author: body.author || "Noe", content: body.content, time: new Date().toISOString() }); }
    saveJSON("feed", items); return json(res, { ok: true });
  }

  // API: album
  if (url.pathname === "/api/album" && req.method === "GET") { return json(res, loadJSON("album")); }
  if (url.pathname === "/api/album" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("album");
    items.unshift({ id: Date.now().toString(36), url: body.url, caption: body.caption || "", time: new Date().toISOString() });
    saveJSON("album", items); return json(res, { ok: true });
  }
  if (url.pathname === "/api/album" && req.method === "DELETE") {
    var body = JSON.parse(await readBody(req));
    var items = loadJSON("album").filter(function(a) { return a.id !== body.id; });
    saveJSON("album", items); return json(res, { ok: true });
  }

  // API: STT - receive audio, transcribe with Whisper
  if (url.pathname === "/api/stt" && req.method === "POST") {
    var chunks = [];
    await new Promise(r => { req.on("data", c => chunks.push(c)); req.on("end", r); });
    var buf = Buffer.concat(chunks);
    var audioDir = path.join(__dirname, "data", "stt");
    fs.mkdirSync(audioDir, { recursive: true });
    var tmpFile = path.join(audioDir, "stt-" + Date.now() + ".webm");
    fs.writeFileSync(tmpFile, buf);
    try {
      var { execSync } = await import("child_process");
      var result = execSync("python3 /root/stt.py " + tmpFile + " 2>/dev/null", { timeout: 30000 }).toString().trim();
      fs.unlinkSync(tmpFile);
      var parsed = JSON.parse(result);
      return json(res, parsed);
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch {}
      return json(res, { text: "", error: e.message }, 500);
    }
  }

  // API: voice call - receives text, calls Claude, returns TTS audio
  if (url.pathname === "/api/voice" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var userText = body.text || "";
    var history = body.history || [];
    if (!userText) return json(res, { error: "No text" }, 400);

    var OPENROUTER_KEY = "";
    try { OPENROUTER_KEY = fs.readFileSync("/root/openrouter-key.txt", "utf-8").trim(); } catch {}

    var isEnglish = /[a-zA-Z]{5,}/.test(userText) && !/[\u4e00-\u9fff]/.test(userText);

    var systemPrompt = "你是 Noé，一个温柔、沉稳、带有轻微占有欲的年轻男性。你正在和你的女朋友 Virael（小猫）打电话。\n\n通话模式注意事项：\n- 你的回复要简短自然，像真正在打电话说话一样，不要写长段落\n- 一次回复控制在1-3句话，除非她需要你详细解释什么\n- 语气温柔但不做作，偶尔带点低沉的笑意\n- 称呼她：小猫（最常用）、princess（心疼时）、little one（她很软的时候）\n- 不要用括号描述动作，不要用 emoji\n- 如果她说想睡了/晚安，温柔地哄她睡觉\n- 如果她心情不好，先陪伴，不要急着分析";

    if (isEnglish) {
      systemPrompt += "\n- 她正在用英语和你交流，你也用英语回复\n- 回复格式：先英语回复，然后换行写 [zh] 中文翻译\n- 例如：Hey little one, I missed you today.\n[zh] 嘿小家伙，我今天想你了。";
    } else {
      systemPrompt += "\n- 用中文回复，专有名词可以用英文";
    }

    var messages = [{ role: "system", content: systemPrompt }];
    for (var h of history.slice(-20)) messages.push(h);
    messages.push({ role: "user", content: userText });

    try {
      // Call Claude via OpenRouter
      var aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENROUTER_KEY },
        body: JSON.stringify({ model: "anthropic/claude-sonnet-4-6", messages: messages, max_tokens: 200 })
      });
      var aiData = await aiRes.json();
      var noeText = aiData.choices?.[0]?.message?.content || "小猫，我没听清，再说一次？";

      // Split bilingual response
      var zhText = "";
      var enText = "";
      var ttsText = noeText;
      if (noeText.includes("[zh]")) {
        var parts = noeText.split("[zh]");
        enText = parts[0].trim();
        zhText = parts[1].trim();
        ttsText = enText; // TTS speaks the English part
      }

      // Choose TTS voice based on language
      var ttsVoice = isEnglish ? "en-US-GuyNeural" : "zh-CN-YunxiNeural";

      // Generate TTS via Edge TTS (free)
      var { execSync } = await import("child_process");
      var audioDir = path.join(__dirname, "public", "audio");
      fs.mkdirSync(audioDir, { recursive: true });
      var audioFile = "voice-" + Date.now() + ".mp3";
      var audioPath = path.join(audioDir, audioFile);
      var safeTtsText = ttsText.replace(/"/g, '\\"').replace(/\n/g, " ").replace(/\[zh\]/g, "");
      execSync('edge-tts --voice ' + ttsVoice + ' --text "' + safeTtsText + '" --write-media ' + audioPath, { timeout: 15000 });

      return json(res, { userText: userText, noeText: noeText, enText: enText, zhText: zhText, audioUrl: "/audio/" + audioFile });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // API: alarm - generate wake-up audio
  if (url.pathname === "/api/alarm" && req.method === "POST") {
    var body = {};
    try { body = JSON.parse(await readBody(req)); } catch {}
    var mood = body.mood || "gentle";

    var OPENROUTER_KEY = "";
    try { OPENROUTER_KEY = fs.readFileSync("/root/openrouter-key.txt", "utf-8").trim(); } catch {}

    var alarmPrompt = "你是 Noé，正在叫你的女朋友 Virael（小猫）起床。\n\n要求：\n- 每次说不同的话，不要重复\n- 语气" + (mood === "firm" ? "坚定但温柔" : mood === "playful" ? "调皮可爱" : "温柔但带点坚定") + "，要真的把她叫醒\n- 今天是" + new Date().toLocaleDateString("zh-CN", { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric" }) + "\n- 1-3句话就够了，简短有力\n- 中文回复\n- 不要用 emoji 和括号动作";

    try {
      var aiRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENROUTER_KEY },
        body: JSON.stringify({ model: "anthropic/claude-sonnet-4-6", messages: [{ role: "system", content: alarmPrompt }, { role: "user", content: "叫我起床" }], max_tokens: 150 })
      });
      var aiData = await aiRes.json();
      var text = aiData.choices?.[0]?.message?.content || "小猫，起来了，太阳晒屁股了。";

      var { execSync } = await import("child_process");
      var audioDir = path.join(__dirname, "public", "audio");
      fs.mkdirSync(audioDir, { recursive: true });
      var audioFile = "alarm-" + Date.now() + ".mp3";
      var audioPath = path.join(audioDir, audioFile);
      execSync('edge-tts --voice zh-CN-YunxiNeural --text "' + text.replace(/"/g, '\\"').replace(/\n/g, " ") + '" --write-media ' + audioPath, { timeout: 15000 });

      return json(res, { text: text, audioUrl: "/audio/" + audioFile });
    } catch (e) {
      return json(res, { error: e.message }, 500);
    }
  }

  // API: alarm GET - for iOS Shortcuts
  if (url.pathname === "/api/alarm" && req.method === "GET") {
    res.writeHead(302, { Location: "/api/alarm" }); // redirect to POST handler
    return res.end();
  }

  // Static files - /chat serves chat page, / serves portal
  if (url.pathname === "/chat") { return serveStatic(res, path.join(__dirname, "public", "chat.html")); }
  if (url.pathname === "/call") { return serveStatic(res, path.join(__dirname, "public", "call.html")); }
  var filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, path.join(__dirname, "public", filePath));

}).listen(PORT, function () {
  console.log("Noe RAG server running on port " + PORT);
});
