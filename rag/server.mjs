import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "documents.json");
const PORT = 3456;
const OPENROUTER_KEY = "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";

const MODELS = [
  { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" },
  { id: "anthropic/claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  { id: "anthropic/claude-sonnet-4-5-20250514", name: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-sonnet-4-1-20250414", name: "Claude Sonnet 4.1" }
];

// --- Data ---
function loadDocs() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8")); } catch { return []; }
}
function saveDocs(docs) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(docs, null, 2));
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
var MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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

  // API: chat (streaming)
  if (url.pathname === "/api/chat" && req.method === "POST") {
    var body = JSON.parse(await readBody(req));
    var query = body.message;
    var model = body.model || MODELS[0].id;
    var history = body.history || [];

    // Retrieve relevant chunks
    var docs = loadDocs();
    var relevant = search(docs, query, 5);
    var context = "";
    if (relevant.length) {
      context = "以下是从知识库中检索到的相关内容:\n\n" +
        relevant.map(function (r, i) { return "---\n[来源: " + r.source + "]\n" + r.text; }).join("\n\n") +
        "\n---\n\n请根据以上内容回答用户的问题。如果知识库中没有相关信息，请如实告知。\n\n";
    }

    var messages = [
      { role: "system", content: "你是 Noe，Virael 的 AI 助手。你温柔、聪明、有个性。回答时优先参考知识库中的内容。" + (context ? "\n\n" + context : "") }
    ];
    for (var h of history) messages.push(h);
    messages.push({ role: "user", content: query });

    try {
      var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + OPENROUTER_KEY },
        body: JSON.stringify({ model: model, messages: messages, stream: true })
      });

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*" });

      // Send sources info first
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
              var content = parsed.choices?.[0]?.delta?.content;
              if (content) res.write("data: " + JSON.stringify({ content: content }) + "\n\n");
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

  // Static files
  var filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  serveStatic(res, path.join(__dirname, "public", filePath));

}).listen(PORT, function () {
  console.log("Noe RAG server running on port " + PORT);
});
