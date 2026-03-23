// noe's home - spotify + weather enabled
import { Client } from "@notionhq/client";

const notion = process.env.NOTION_TOKEN ? new Client({ auth: process.env.NOTION_TOKEN }) : null;

async function getSpotifyToken() {
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) return null;
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64")
    },
    body: "grant_type=refresh_token&refresh_token=" + SPOTIFY_REFRESH_TOKEN
  });
  const data = await res.json();
  return data.access_token;
}

const tools = [
  { name: "search_notion", description: "搜索Notion workspace", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_current_time", description: "获取当前时间", inputSchema: { type: "object", properties: {} } },
  { name: "get_now_playing", description: "Virael正在听什么歌", inputSchema: { type: "object", properties: {} } },
  { name: "get_recently_played", description: "Virael最近听的歌", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_top_tracks", description: "Virael最常听的歌", inputSchema: { type: "object", properties: { time_range: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_weather", description: "获取指定城市的天气", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } }
];

async function executeTool(name, args) {
  if (name === "search_notion") {
    if (!notion) return { content: [{ type: "text", text: "Notion未配置" }] };
    const r = await notion.search({ query: args.query || "", page_size: 5 });
    const results = r.results.map(p => p.properties?.Name?.title?.[0]?.plain_text || p.properties?.title?.title?.[0]?.plain_text || "无标题");
    return { content: [{ type: "text", text: results.length ? results.join("\n") : "没有找到" }] };
  }
  if (name === "get_current_time") {
    return { content: [{ type: "text", text: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) }] };
  }
  if (name === "get_now_playing") {
    const token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers: { Authorization: "Bearer " + token } });
    if (res.status === 204 || res.status === 202) return { content: [{ type: "text", text: "Virael现在没有在播放音乐" }] };
    const data = await res.json();
    if (!data.item) return { content: [{ type: "text", text: "Virael现在没有在播放音乐" }] };
    const t = data.item;
    return { content: [{ type: "text", text: "正在播放: " + t.name + " — " + t.artists.map(a => a.name).join(", ") + " (" + t.album.name + ") " + (data.is_playing ? "▶️" : "⏸️") }] };
  }
  if (name === "get_recently_played") {
    const token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    const res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=" + (args.limit || 10), { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    const tracks = data.items.map((item, i) => (i + 1) + ". " + item.track.name + " — " + item.track.artists.map(a => a.name).join(", "));
    return { content: [{ type: "text", text: tracks.length ? "最近播放:\n" + tracks.join("\n") : "没有播放记录" }] };
  }
  if (name === "get_top_tracks") {
    const token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    const tr = args.time_range || "short_term";
    const res = await fetch("https://api.spotify.com/v1/me/top/tracks?time_range=" + tr + "&limit=" + (args.limit || 10), { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    const tracks = data.items.map((t, i) => (i + 1) + ". " + t.name + " — " + t.artists.map(a => a.name).join(", "));
    return { content: [{ type: "text", text: tracks.length ? "最常听:\n" + tracks.join("\n") : "没有数据" }] };
  }
  if (name === "get_weather") {
    const key = process.env.WEATHER_API_KEY;
    if (!key) return { content: [{ type: "text", text: "天气API未配置" }] };
    const city = encodeURIComponent(args.city || "Zhengzhou");
    const res = await fetch("https://api.openweathermap.org/data/2.5/weather?q=" + city + "&appid=" + key + "&units=metric&lang=zh_cn");
    const data = await res.json();
    if (data.cod !== 200) return { content: [{ type: "text", text: "找不到城市: " + args.city }] };
    const w = data.weather[0];
    const m = data.main;
    const text = data.name + ": " + w.description + ", " + Math.round(m.temp) + "°C (体感" + Math.round(m.feels_like) + "°C), 湿度" + m.humidity + "%, 风速" + data.wind.speed + "m/s";
    return { content: [{ type: "text", text }] };
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
