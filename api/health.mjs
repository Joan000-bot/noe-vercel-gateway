export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    status: "ok",
    name: "Noé MCP Gateway",
    version: "2.2.0",
    message: "火还在烧着 🔥",
    tools: 13,
    timestamp: new Date().toISOString()
  });
}
