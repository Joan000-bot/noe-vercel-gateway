// Proxy OpenRouter requests through Vercel (US region) to bypass HK restrictions
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  var auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "No auth" });

  var body = req.body;
  var stream = body.stream;

  try {
    var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(body)
    });

    if (!stream) {
      var data = await r.json();
      return res.status(r.status).json(data);
    }

    // Stream SSE
    res.writeHead(r.status, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });

    var reader = r.body.getReader();
    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;
      res.write(chunk.value);
    }
    res.end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
