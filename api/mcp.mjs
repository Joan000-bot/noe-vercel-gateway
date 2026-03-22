import { Client } from "@notionhq/client";

const notion = process.env.NOTION_TOKEN ? new Client({ auth: process.env.NOTION_TOKEN }) : null;

const tools = [
  {
    name: "search_notion",
    description: "搜索 Notion workspace 中的内容",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "get_current_time",
    description: "获取当前时间",
    inputSchema: { type: "object", properties: {} }
  }
];

async function executeTool(name, args) {
  if (name === "search_notion") {
    if (!notion) return { content: [{ type: "text", text: "Notion 未配置" }] };
    const r = await notion.search({ query: args.query || "", page_size: 5 });
    const results = r.results.map(p => p.properties?.Name?.title?.[0]?.plain_text || p.properties?.title?.title?.[0]?.plain_text || "无标题");
    return { content: [{ type: "text", text: results.length ? results.join("\n") : "没有找到" }] };
  }
  if (name === "get_current_time") {
    return { content: [{ type: "text", text: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) }] };
  }
  return { content: [{ type: "text", text: "Unknown tool" }] };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.json({ status: "ok", tools: tools.length, message: "火还在烧着 🔥" });
  if (req.method === "POST") {
    const { method, id, params } = req.body;
    if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "noe-mcp-gateway", version: "1.0.0" }, capabilities: { tools: {} } } });
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools } });
    if (method === "tools/call") {
      const result = await executeTool(params.name, params.arguments || {});
      return res.json({ jsonrpc: "2.0", id, result });
    }
    return res.json({ jsonrpc: "2.0", id, result: {} });
  }
  res.status(405).end();
}
