export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    status: "ok",
    name: "Noé MCP Gateway",
    version: "1.0.0",
    message: "火还在烧着 🔥",
    timestamp: new Date().toISOString()
  });
}
