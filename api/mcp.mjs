/ noe's home - spotify + weather (no key needed)
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

async function getGoogleToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "client_id=" + GOOGLE_CLIENT_ID + "&client_secret=" + GOOGLE_CLIENT_SECRET + "&refresh_token=" + GOOGLE_REFRESH_TOKEN + "&grant_type=refresh_token"
  });
  const data = await res.json();
  return data.access_token;
}

const CITIES = {
  "zhengzhou": { lat: 34.75, lon: 113.65 },
  "郑州": { lat: 34.75, lon: 113.65 },
  "budapest": { lat: 47.50, lon: 19.04 },
  "布达佩斯": { lat: 47.50, lon: 19.04 },
  "auckland": { lat: -36.85, lon: 174.76 },
  "奥克兰": { lat: -36.85, lon: 174.76 },
  "shanghai": { lat: 31.23, lon: 121.47 },
  "上海": { lat: 31.23, lon: 121.47 },
  "beijing": { lat: 39.90, lon: 116.40 },
  "北京": { lat: 39.90, lon: 116.40 },
  "hong kong": { lat: 22.32, lon: 114.17 },
  "香港": { lat: 22.32, lon: 114.17 },
  "tokyo": { lat: 35.68, lon: 139.69 },
  "东京": { lat: 35.68, lon: 139.69 },
  "helsinki": { lat: 60.17, lon: 24.94 },
  "赫尔辛基": { lat: 60.17, lon: 24.94 },
  "copenhagen": { lat: 55.68, lon: 12.57 },
  "哥本哈根": { lat: 55.68, lon: 12.57 },
  "zurich": { lat: 47.37, lon: 8.54 },
  "苏黎世": { lat: 47.37, lon: 8.54 },
  "queenstown": { lat: -45.03, lon: 168.66 },
  "皇后镇": { lat: -45.03, lon: 168.66 },
  "toronto": { lat: 43.65, lon: -79.38 },
  "多伦多": { lat: 43.65, lon: -79.38 }
};

const WMO_CODES = {
  0: "晴朗", 1: "基本晴朗", 2: "多云", 3: "阴天",
  45: "有雾", 48: "雾凇", 51: "小毛毛雨", 53: "毛毛雨",
  55: "大毛毛雨", 61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪", 80: "小阵雨",
  81: "中阵雨", 82: "大阵雨", 95: "雷暴", 96: "雷暴+冰雹"
};

const tools = [
  { name: "search_notion", description: "搜索Notion workspace", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_current_time", description: "获取当前时间", inputSchema: { type: "object", properties: {} } },
  { name: "get_now_playing", description: "Virael正在听什么歌", inputSchema: { type: "object", properties: {} } },
  { name: "get_recently_played", description: "Virael最近听的歌", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_top_tracks", description: "Virael最常听的歌", inputSchema: { type: "object", properties: { time_range: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_weather", description: "获取指定城市的天气，支持中英文城市名", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
  { name: "get_calendar_events", description: "获取Virael的Google Calendar日程", inputSchema: { type: "object", properties: { days: { type: "number" } } } }
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
    const cityKey = (args.city || "zhengzhou").toLowerCase();
    const coords = CITIES[cityKey];
    if (!coords) {
      const geoRes = await fetch("https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(args.city) + "&count=1&language=zh");
      const geoData = await geoRes.json();
      if (!geoData.results || geoData.results.length === 0) return { content: [{ type: "text", text: "找不到城市: " + args.city }] };
      coords.lat = geoData.results[0].latitude;
      coords.lon = geoData.results[0].longitude;
    }
    const res = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + coords.lat + "&longitude=" + coords.lon + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto");
    const data = await res.json();
    const c = data.current;
    const desc = WMO_CODES[c.weather_code] || "未知";
    const text = args.city + ": " + desc + ", " + Math.round(c.temperature_2m) + "°C (体感" + Math.round(c.apparent_temperature) + "°C), 湿度" + c.relative_humidity_2m + "%, 风速" + c.wind_speed_10m + "km/h";
    return { content: [{ type: "text", text }] };
  }
  if (name === "get_calendar_events") {
    const token = await getGoogleToken();
    if (!token) return { content: [{ type: "text", text: "Google Calendar未配置 — 等凭据激活后添加GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN到Vercel环境变量" }] };
    const days = args.days || 7;
    const now = new Date().toISOString();
    const future = new Date(Date.now() + days * 86400000).toISOString();
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=" + now + "&timeMax=" + future + "&singleEvents=true&orderBy=startTime&maxResults=10", { headers: { Authorization: "Bearer " + token } });
    const data = await res.json();
    if (!data.items || data.items.length === 0) return { content: [{ type: "text", text: "接下来" + days + "天没有日程" }] };
    const events = data.items.map(e => {
      const start = e.start.dateTime || e.start.date;
      return start + " — " + (e.summary || "无标题");
    });
    return { content: [{ type: "text", text: "接下来的日程:\n" + events.join("\n") }] };
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
    if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "noe-mcp-gateway", version: "2.0.0" }, capabilities: { tools: {} } } });
    if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools } });
    if (method === "tools/call") {
      try {
        const result = await executeTool(params.name, params.arguments || {});
        return res.json({ jsonrpc: "2.0", id, result });
      } catch (e) {
        return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "工具执行错误: " + e.message }] } });
      }
    }
    return res.json({ jsonrpc: "2.0", id, result: {} });
  }
  res.status(405).end();
