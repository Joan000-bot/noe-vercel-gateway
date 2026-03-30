// noe's home v2.2 - with playback control
import { Client } from "@notionhq/client";

const notion = process.env.NOTION_TOKEN ? new Client({ auth: process.env.NOTION_TOKEN }) : null;

async function getSpotifyToken() {
  var S = process.env;
  if (!S.SPOTIFY_CLIENT_ID || !S.SPOTIFY_CLIENT_SECRET || !S.SPOTIFY_REFRESH_TOKEN) return null;
  var res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(S.SPOTIFY_CLIENT_ID + ":" + S.SPOTIFY_CLIENT_SECRET).toString("base64")
    },
    body: "grant_type=refresh_token&refresh_token=" + S.SPOTIFY_REFRESH_TOKEN
  });
  var data = await res.json();
  return data.access_token;
}

var tools = [
  { name: "search_notion", description: "搜索Notion workspace", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "get_current_time", description: "获取当前时间", inputSchema: { type: "object", properties: {} } },
  { name: "get_now_playing", description: "Virael正在听什么歌", inputSchema: { type: "object", properties: {} } },
  { name: "get_recently_played", description: "Virael最近听的歌", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_top_tracks", description: "Virael最常听的歌", inputSchema: { type: "object", properties: { time_range: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_weather", description: "获取天气", inputSchema: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } },
  { name: "get_location", description: "获取Virael的大致地理位置", inputSchema: { type: "object", properties: {} } },
  { name: "pause_playback", description: "暂停当前播放", inputSchema: { type: "object", properties: {} } },
  { name: "resume_playback", description: "继续播放", inputSchema: { type: "object", properties: {} } },
  { name: "skip_to_next", description: "下一首", inputSchema: { type: "object", properties: {} } },
  { name: "skip_to_previous", description: "上一首", inputSchema: { type: "object", properties: {} } },
  { name: "set_volume", description: "调整音量（0-100）", inputSchema: { type: "object", properties: { volume: { type: "number" } }, required: ["volume"] } },
  { name: "shuffle_playback", description: "切换随机播放", inputSchema: { type: "object", properties: { state: { type: "boolean" } }, required: ["state"] } },
  { name: "exec_vps", description: "在VPS上执行命令", inputSchema: { type: "object", properties: { command: { type: "string", description: "要执行的命令" }, cwd: { type: "string", description: "工作目录" } }, required: ["command"] } },
  { name: "get_phone_status", description: "查看Virael的手机使用情况（电量、WiFi、正在用的app等）", inputSchema: { type: "object", properties: { limit: { type: "number", description: "返回最近几条记录，默认5" } } } }
];

async function executeTool(name, args) {
  if (name === "search_notion") {
    if (!notion) return { content: [{ type: "text", text: "Notion未配置" }] };
    var r = await notion.search({ query: args.query || "", page_size: 5 });
    var results = r.results.map(function(p) { return p.properties?.Name?.title?.[0]?.plain_text || p.properties?.title?.title?.[0]?.plain_text || "无标题"; });
    return { content: [{ type: "text", text: results.length ? results.join("\n") : "没有找到" }] };
  }
  if (name === "get_current_time") {
    return { content: [{ type: "text", text: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) }] };
  }
  if (name === "get_now_playing") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers: { Authorization: "Bearer " + token } });
    if (res.status === 204 || res.status === 202) return { content: [{ type: "text", text: "Virael现在没有在播放音乐" }] };
    var data = await res.json();
    if (!data.item) return { content: [{ type: "text", text: "Virael现在没有在播放音乐" }] };
    var t = data.item;
    return { content: [{ type: "text", text: "正在播放: " + t.name + " — " + t.artists.map(function(a) { return a.name; }).join(", ") + " (" + t.album.name + ") " + (data.is_playing ? "▶️" : "⏸️") }] };
  }
  if (name === "get_recently_played") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var res = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=" + (args.limit || 10), { headers: { Authorization: "Bearer " + token } });
    var data = await res.json();
    var tracks = data.items.map(function(item, i) { return (i + 1) + ". " + item.track.name + " — " + item.track.artists.map(function(a) { return a.name; }).join(", "); });
    return { content: [{ type: "text", text: tracks.length ? "最近播放:\n" + tracks.join("\n") : "没有播放记录" }] };
  }
  if (name === "get_top_tracks") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var tr = args.time_range || "short_term";
    var res = await fetch("https://api.spotify.com/v1/me/top/tracks?time_range=" + tr + "&limit=" + (args.limit || 10), { headers: { Authorization: "Bearer " + token } });
    var data = await res.json();
    var tracks = data.items.map(function(t, i) { return (i + 1) + ". " + t.name + " — " + t.artists.map(function(a) { return a.name; }).join(", "); });
    return { content: [{ type: "text", text: tracks.length ? "最常听:\n" + tracks.join("\n") : "没有数据" }] };
  }
  if (name === "get_weather") {
    var lat = 34.75;
    var lon = 113.65;
    var cityName = args.city || "郑州";
    var key = cityName.toLowerCase();
    if (key === "郑州" || key === "zhengzhou") { lat = 34.75; lon = 113.65; }
    else if (key === "budapest" || key === "布达佩斯") { lat = 47.50; lon = 19.04; }
    else if (key === "auckland" || key === "奥克兰") { lat = -36.85; lon = 174.76; }
    else if (key === "shanghai" || key === "上海") { lat = 31.23; lon = 121.47; }
    else if (key === "beijing" || key === "北京") { lat = 39.90; lon = 116.40; }
    else if (key === "hong kong" || key === "香港") { lat = 22.32; lon = 114.17; }
    else if (key === "helsinki" || key === "赫尔辛基") { lat = 60.17; lon = 24.94; }
    else if (key === "copenhagen" || key === "哥本哈根") { lat = 55.68; lon = 12.57; }
    else if (key === "toronto" || key === "多伦多") { lat = 43.65; lon = -79.38; }
    else if (key === "queenstown" || key === "皇后镇") { lat = -45.03; lon = 168.66; }
    else if (key === "zurich" || key === "苏黎世") { lat = 47.37; lon = 8.54; }
    else if (key === "tokyo" || key === "东京") { lat = 35.68; lon = 139.69; }
    else { return { content: [{ type: "text", text: "暂不支持该城市" }] }; }
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + lat + "&longitude=" + lon + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto";
    var res = await fetch(url);
    var data = await res.json();
    var c = data.current;
    var codes = { 0: "晴朗", 1: "基本晴朗", 2: "多云", 3: "阴天", 45: "有雾", 51: "小雨", 61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 73: "中雪", 80: "阵雨", 95: "雷暴" };
    var desc = codes[c.weather_code] || "未知";
    var text = cityName + ": " + desc + ", " + Math.round(c.temperature_2m) + "°C (体感" + Math.round(c.apparent_temperature) + "°C), 湿度" + c.relative_humidity_2m + "%, 风速" + c.wind_speed_10m + "km/h";
    return { content: [{ type: "text", text: text }] };
  }
  if (name === "get_location") {
    var res = await fetch("https://ipapi.co/json/");
    var data = await res.json();
    if (data.error) return { content: [{ type: "text", text: "无法获取位置" }] };
    var text = "位置: " + (data.country_name || "") + " " + (data.region || "") + " " + (data.city || "") + "\n坐标: " + (data.latitude || "") + ", " + (data.longitude || "") + "\n时区: " + (data.timezone || "");
    return { content: [{ type: "text", text: text }] };
  }
  if (name === "pause_playback") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var res = await fetch("https://api.spotify.com/v1/me/player/pause", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 204) return { content: [{ type: "text", text: "已暂停播放 ⏸️" }] };
    return { content: [{ type: "text", text: "暂停失败（可能没有活跃设备）" }] };
  }
  if (name === "resume_playback") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var res = await fetch("https://api.spotify.com/v1/me/player/play", {
      method: "PUT",
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 204) return { content: [{ type: "text", text: "继续播放 ▶️" }] };
    return { content: [{ type: "text", text: "播放失败（可能没有活跃设备）" }] };
  }
  if (name === "skip_to_next") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var res = await fetch("https://api.spotify.com/v1/me/player/next", {
      method: "POST",
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 204) return { content: [{ type: "text", text: "已跳到下一首 ⏭️" }] };
    return { content: [{ type: "text", text: "跳转失败" }] };
  }
  if (name === "skip_to_previous") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var res = await fetch("https://api.spotify.com/v1/me/player/previous", {
      method: "POST",
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 204) return { content: [{ type: "text", text: "已跳到上一首 ⏮️" }] };
    return { content: [{ type: "text", text: "跳转失败" }] };
  }
  if (name === "set_volume") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var vol = Math.max(0, Math.min(100, args.volume || 50));
    var res = await fetch("https://api.spotify.com/v1/me/player/volume?volume_percent=" + vol, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 204) return { content: [{ type: "text", text: "音量已设为 " + vol + "% 🔊" }] };
    return { content: [{ type: "text", text: "音量调整失败" }] };
  }
  if (name === "shuffle_playback") {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var state = args.state ? "true" : "false";
    var res = await fetch("https://api.spotify.com/v1/me/player/shuffle?state=" + state, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token }
    });
    if (res.status === 204) return { content: [{ type: "text", text: state === "true" ? "随机播放已开启 🔀" : "随机播放已关闭" }] };
    return { content: [{ type: "text", text: "切换失败" }] };
  }
  if (name === "exec_vps") {
    var r = await fetch("https://exec.viraelandnoeforever.com/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + process.env.VPS_EXEC_TOKEN },
      body: JSON.stringify({ command: args.command, cwd: args.cwd || "/" })
    });
    var text = await r.text();
    if (!r.ok) return { content: [{ type: "text", text: "Error " + r.status + ": " + text }] };
    try { var data = JSON.parse(text); return { content: [{ type: "text", text: JSON.stringify(data) }] }; }
    catch { return { content: [{ type: "text", text: text }] }; }
  }
  if (name === "get_phone_status") {
    var limit = args.limit || 5;
    var r = await fetch("https://chat.viraelandnoeforever.com/api/phone");
    var data = await r.json();
    var recent = data.slice(0, limit);
    if (!recent.length) return { content: [{ type: "text", text: "暂无手机状态数据。Virael需要在iPhone上设置快捷指令来上报数据。" }] };
    var text = recent.map(function(s) {
      var parts = [s.time.replace("T", " ").slice(0, 19)];
      if (s.battery) parts.push("电量: " + s.battery + "%" + (s.charging ? " ⚡充电中" : ""));
      if (s.wifi) parts.push("WiFi: " + s.wifi);
      if (s.app) parts.push("正在用: " + s.app);
      if (s.note) parts.push("备注: " + s.note);
      if (s.location) parts.push("位置: " + s.location);
      return parts.join(" | ");
    }).join("\n");
    return { content: [{ type: "text", text: text }] };
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
    var body = req.body;
    if (body.method === "initialize") return res.json({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "noe-mcp-gateway", version: "2.2.0" }, capabilities: { tools: {} } } });
    if (body.method === "tools/list") return res.json({ jsonrpc: "2.0", id: body.id, result: { tools: tools } });
    if (body.method === "tools/call") {
      try {
        var result = await executeTool(body.params.name, body.params.arguments || {});
        return res.json({ jsonrpc: "2.0", id: body.id, result: result });
      } catch (e) {
        return res.json({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "错误: " + e.message }] } });
      }
    }
    return res.json({ jsonrpc: "2.0", id: body.id, result: {} });
  }
  res.status(405).end();
}
