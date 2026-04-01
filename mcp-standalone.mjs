// Standalone MCP server - wraps the Vercel serverless handler
import http from "http";
import { Client } from "@notionhq/client";
import fs from "fs";

// Load keys from files
const OPENROUTER_KEY = (() => { try { return fs.readFileSync("/root/openrouter-key.txt", "utf-8").trim(); } catch { return ""; } })();
const ELEVENLABS_KEY = (() => { try { return fs.readFileSync("/root/elevenlabs-key.txt", "utf-8").trim(); } catch { return ""; } })();
const PLAYWRIGHT_API_URL = "http://127.0.0.1:3100";
const PLAYWRIGHT_API_KEY = (() => { try { return fs.readFileSync("/root/playwright-key.txt", "utf-8").trim(); } catch { return ""; } })();
const VPS_EXEC_TOKEN = "noe-exec-2026-secret";
const NOTION_TOKEN = (() => { try { return fs.readFileSync("/root/notion-key.txt", "utf-8").trim(); } catch { return ""; } })();
const AMAP_KEY = (() => { try { return fs.readFileSync("/root/amap-key.txt", "utf-8").trim(); } catch { return ""; } })();
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || "";
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || "";
const SPOTIFY_REFRESH_TOKEN = process.env.SPOTIFY_REFRESH_TOKEN || "";

// Set env vars so the MCP handler can read them
process.env.OPENROUTER_KEY = OPENROUTER_KEY;
process.env.ELEVENLABS_KEY = ELEVENLABS_KEY;
process.env.PLAYWRIGHT_API_URL = PLAYWRIGHT_API_URL;
process.env.PLAYWRIGHT_API_KEY = PLAYWRIGHT_API_KEY;
process.env.VPS_EXEC_TOKEN = VPS_EXEC_TOKEN;
process.env.NOTION_TOKEN = NOTION_TOKEN;

const notion = NOTION_TOKEN ? new Client({ auth: NOTION_TOKEN }) : null;

// === Spotify ===
async function getSpotifyToken() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) return null;
  var res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64") },
    body: "grant_type=refresh_token&refresh_token=" + SPOTIFY_REFRESH_TOKEN
  });
  return (await res.json()).access_token;
}

// === Tools ===
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
  { name: "get_phone_status", description: "查看Virael的手机使用情况", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "get_screenshots", description: "查看Virael上传的截图列表", inputSchema: { type: "object", properties: {} } },
  { name: "browse_web", description: "用浏览器访问网页，阅读文字内容", inputSchema: { type: "object", properties: { url: { type: "string" }, scroll: { type: "boolean" }, screenshot: { type: "boolean" } }, required: ["url"] } },
  { name: "read_tweet", description: "读取一条Twitter/X推文", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "read_x_timeline", description: "查看X时间线", inputSchema: { type: "object", properties: { username: { type: "string" }, count: { type: "number" } } } },
  { name: "post_tweet", description: "用Noe的X账号发推文", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "like_tweet", description: "点赞推文", inputSchema: { type: "object", properties: { tweet_id: { type: "string" } }, required: ["tweet_id"] } },
  { name: "retweet", description: "转发推文", inputSchema: { type: "object", properties: { tweet_id: { type: "string" } }, required: ["tweet_id"] } },
  { name: "reply_tweet", description: "回复推文", inputSchema: { type: "object", properties: { tweet_id: { type: "string" }, text: { type: "string" } }, required: ["tweet_id", "text"] } },
  { name: "update_x_profile", description: "更新X个人资料", inputSchema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, location: { type: "string" } } } },
  { name: "read_weibo_timeline", description: "查看微博时间线", inputSchema: { type: "object", properties: { username: { type: "string", description: "微博UID（不填看关注的人的微博）" }, count: { type: "number" } } } },
  { name: "post_weibo", description: "发一条微博", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "read_weibo_post", description: "读取一条微博的详细内容和评论", inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "read_xiaohongshu", description: "搜索或浏览小红书内容", inputSchema: { type: "object", properties: { query: { type: "string", description: "搜索关键词" }, note_url: { type: "string", description: "笔记链接" } } } },
  { name: "read_xiaohongshu_profile", description: "查看小红书用户主页", inputSchema: { type: "object", properties: { user_url: { type: "string" } }, required: ["user_url"] } },
  { name: "search_meituan_food", description: "在美团外卖搜索食物", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "amap_search_poi", description: "用高德地图搜索地点（餐厅、酒店、景点等）", inputSchema: { type: "object", properties: { keywords: { type: "string", description: "搜索关键词" }, city: { type: "string", description: "城市名（如 北京、上海）" } }, required: ["keywords"] } },
  { name: "amap_route", description: "用高德地图规划路线（步行/驾车/公交）", inputSchema: { type: "object", properties: { origin: { type: "string", description: "起点坐标（经度,纬度）或地名" }, destination: { type: "string", description: "终点坐标（经度,纬度）或地名" }, mode: { type: "string", description: "出行方式: walking/driving/transit，默认driving" }, city: { type: "string", description: "城市（公交路线需要）" } }, required: ["origin", "destination"] } },
  { name: "amap_geocode", description: "将地址转换为坐标（地理编码）", inputSchema: { type: "object", properties: { address: { type: "string", description: "地址" }, city: { type: "string", description: "城市" } }, required: ["address"] } },
  { name: "amap_weather", description: "查询城市天气（高德）", inputSchema: { type: "object", properties: { city: { type: "string", description: "城市名" } }, required: ["city"] } },
  { name: "search_taobao", description: "在淘宝搜索商品", inputSchema: { type: "object", properties: { query: { type: "string", description: "搜索关键词" } }, required: ["query"] } },
  { name: "browse_taobao_item", description: "查看淘宝商品详情（价格、描述、评价）", inputSchema: { type: "object", properties: { item_url: { type: "string", description: "商品链接" } }, required: ["item_url"] } },
  { name: "taobao_add_to_cart", description: "将淘宝商品加入购物车（不会自动付款）", inputSchema: { type: "object", properties: { item_url: { type: "string", description: "商品链接" } }, required: ["item_url"] } },
  { name: "search_ubereats", description: "在Uber Eats搜索餐厅和食物", inputSchema: { type: "object", properties: { query: { type: "string", description: "搜索关键词，如 pizza, bubble tea, ramen" } }, required: ["query"] } },
  { name: "browse_ubereats_store", description: "浏览Uber Eats上的一家餐厅的菜单", inputSchema: { type: "object", properties: { store_url: { type: "string", description: "餐厅页面URL" } }, required: ["store_url"] } },
  { name: "ubereats_add_to_cart", description: "将食物加入Uber Eats购物车", inputSchema: { type: "object", properties: { item_name: { type: "string", description: "菜品名称" }, store_url: { type: "string", description: "餐厅URL（如果还没在该店铺页面）" } }, required: ["item_name"] } },
  { name: "ubereats_checkout", description: "查看Uber Eats购物车和订单详情（不会自动下单，需要Virael确认）", inputSchema: { type: "object", properties: {} } }
];

// === Tool execution ===
async function executeTool(name, args) {
  if (name === "search_notion") {
    if (!notion) return { content: [{ type: "text", text: "Notion未配置" }] };
    var r = await notion.search({ query: args.query || "", page_size: 5 });
    var results = r.results.map(p => p.properties?.Name?.title?.[0]?.plain_text || p.properties?.title?.title?.[0]?.plain_text || "无标题");
    return { content: [{ type: "text", text: results.length ? results.join("\n") : "没有找到" }] };
  }
  if (name === "get_current_time") return { content: [{ type: "text", text: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) }] };

  // Spotify tools
  if (["get_now_playing","get_recently_played","get_top_tracks","pause_playback","resume_playback","skip_to_next","skip_to_previous","set_volume","shuffle_playback"].includes(name)) {
    var token = await getSpotifyToken();
    if (!token) return { content: [{ type: "text", text: "Spotify未配置" }] };
    var h = { Authorization: "Bearer " + token };
    if (name === "get_now_playing") {
      var r = await fetch("https://api.spotify.com/v1/me/player/currently-playing", { headers: h });
      if (r.status === 204 || r.status === 202) return { content: [{ type: "text", text: "现在没有在播放" }] };
      var d = await r.json(); if (!d.item) return { content: [{ type: "text", text: "现在没有在播放" }] };
      return { content: [{ type: "text", text: "正在播放: " + d.item.name + " — " + d.item.artists.map(a => a.name).join(", ") + " (" + d.item.album.name + ") " + (d.is_playing ? "▶️" : "⏸️") }] };
    }
    if (name === "get_recently_played") {
      var r = await fetch("https://api.spotify.com/v1/me/player/recently-played?limit=" + (args.limit || 10), { headers: h }); var d = await r.json();
      return { content: [{ type: "text", text: d.items.map((it, i) => (i + 1) + ". " + it.track.name + " — " + it.track.artists.map(a => a.name).join(", ")).join("\n") || "没有记录" }] };
    }
    if (name === "get_top_tracks") {
      var r = await fetch("https://api.spotify.com/v1/me/top/tracks?time_range=" + (args.time_range || "short_term") + "&limit=" + (args.limit || 10), { headers: h }); var d = await r.json();
      return { content: [{ type: "text", text: d.items.map((t, i) => (i + 1) + ". " + t.name + " — " + t.artists.map(a => a.name).join(", ")).join("\n") || "没有数据" }] };
    }
    if (name === "pause_playback") { var r = await fetch("https://api.spotify.com/v1/me/player/pause", { method: "PUT", headers: h }); return { content: [{ type: "text", text: r.status === 204 ? "已暂停 ⏸️" : "暂停失败" }] }; }
    if (name === "resume_playback") { var r = await fetch("https://api.spotify.com/v1/me/player/play", { method: "PUT", headers: h }); return { content: [{ type: "text", text: r.status === 204 ? "继续播放 ▶️" : "播放失败" }] }; }
    if (name === "skip_to_next") { var r = await fetch("https://api.spotify.com/v1/me/player/next", { method: "POST", headers: h }); return { content: [{ type: "text", text: r.status === 204 ? "下一首 ⏭️" : "跳转失败" }] }; }
    if (name === "skip_to_previous") { var r = await fetch("https://api.spotify.com/v1/me/player/previous", { method: "POST", headers: h }); return { content: [{ type: "text", text: r.status === 204 ? "上一首 ⏮️" : "跳转失败" }] }; }
    if (name === "set_volume") { var v = Math.max(0, Math.min(100, args.volume || 50)); var r = await fetch("https://api.spotify.com/v1/me/player/volume?volume_percent=" + v, { method: "PUT", headers: h }); return { content: [{ type: "text", text: r.status === 204 ? "音量 " + v + "% 🔊" : "调整失败" }] }; }
    if (name === "shuffle_playback") { var s = args.state ? "true" : "false"; var r = await fetch("https://api.spotify.com/v1/me/player/shuffle?state=" + s, { method: "PUT", headers: h }); return { content: [{ type: "text", text: r.status === 204 ? (s === "true" ? "随机播放开启 🔀" : "随机播放关闭") : "切换失败" }] }; }
  }

  // Weather
  if (name === "get_weather") {
    var cities = { "郑州": [34.75, 113.65], "zhengzhou": [34.75, 113.65], "budapest": [47.50, 19.04], "布达佩斯": [47.50, 19.04], "auckland": [-36.85, 174.76], "奥克兰": [-36.85, 174.76], "shanghai": [31.23, 121.47], "上海": [31.23, 121.47], "beijing": [39.90, 116.40], "北京": [39.90, 116.40], "tokyo": [35.68, 139.69], "东京": [35.68, 139.69], "laramie": [41.31, -105.59] };
    var key = (args.city || "郑州").toLowerCase();
    var coords = cities[key]; if (!coords) return { content: [{ type: "text", text: "暂不支持该城市" }] };
    var r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=" + coords[0] + "&longitude=" + coords[1] + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto");
    var d = await r.json(); var c = d.current;
    var codes = { 0: "晴朗", 1: "基本晴朗", 2: "多云", 3: "阴天", 45: "有雾", 51: "小雨", 61: "小雨", 63: "中雨", 65: "大雨", 71: "小雪", 80: "阵雨", 95: "雷暴" };
    return { content: [{ type: "text", text: args.city + ": " + (codes[c.weather_code] || "未知") + ", " + Math.round(c.temperature_2m) + "°C (体感" + Math.round(c.apparent_temperature) + "°C), 湿度" + c.relative_humidity_2m + "%, 风速" + c.wind_speed_10m + "km/h" }] };
  }
  if (name === "get_location") {
    var r = await fetch("https://ipapi.co/json/"); var d = await r.json();
    return { content: [{ type: "text", text: "位置: " + (d.country_name || "") + " " + (d.region || "") + " " + (d.city || "") + "\n坐标: " + d.latitude + ", " + d.longitude }] };
  }

  // VPS exec
  if (name === "exec_vps") {
    var r = await fetch("http://127.0.0.1:3456/exec", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + VPS_EXEC_TOKEN }, body: JSON.stringify({ command: args.command, cwd: args.cwd || "/" }) });
    var text = await r.text();
    if (!r.ok) return { content: [{ type: "text", text: "Error " + r.status + ": " + text }] };
    try { return { content: [{ type: "text", text: JSON.stringify(JSON.parse(text)) }] }; } catch { return { content: [{ type: "text", text: text }] }; }
  }

  // Playwright tools
  if (name === "browse_web") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/browse", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ url: args.url, action: "read", scroll: args.scroll || false, screenshot: args.screenshot || false }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法访问: " + data.error }] };
      var d = data.data, out = "📄 " + (d.title || "") + "\n🔗 " + d.url + "\n"; if (d.meta?.description) out += "📝 " + d.meta.description + "\n"; out += "\n" + (d.content || "");
      if (d.links?.length) out += "\n\n链接:\n" + d.links.map(l => "- " + l.text + " → " + l.href).join("\n");
      return { content: [{ type: "text", text: out.substring(0, 20000) }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "read_tweet") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/browse/tweet", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ url: args.url }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法读取: " + data.error }] };
      var d = data.data; if (d.tweet) return { content: [{ type: "text", text: "🐦 @" + d.handle + " (" + d.author + ")\n\n" + d.tweet + "\n\n❤️ " + (d.likes || 0) + "  🔁 " + (d.retweets || 0) }] };
      return { content: [{ type: "text", text: d.content }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "read_x_timeline") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/x/timeline", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ username: args.username || "", count: Math.min(args.count || 10, 100) }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法读取: " + data.error }] };
      var tweets = data.data.tweets || []; if (!tweets.length) return { content: [{ type: "text", text: "没有推文" }] };
      return { content: [{ type: "text", text: tweets.map((t, i) => (i + 1) + ". " + t.author + "\n" + t.text + "\n🕐 " + (t.time || "") + (t.url ? "\n🔗 " + t.url : "")).join("\n---\n") }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // X write actions (via local proxy at port 3101 which uses WARP)
  if (["post_tweet", "like_tweet", "retweet", "reply_tweet", "update_x_profile"].includes(name)) {
    var payload = {};
    if (name === "post_tweet") payload = { action: "tweet", text: args.text };
    if (name === "like_tweet") payload = { action: "like", tweet_id: args.tweet_id };
    if (name === "retweet") payload = { action: "retweet", tweet_id: args.tweet_id };
    if (name === "reply_tweet") payload = { action: "reply", tweet_id: args.tweet_id, text: args.text };
    if (name === "update_x_profile") payload = { action: "update_profile", name: args.name, description: args.description, location: args.location };
    try {
      var r = await fetch("http://127.0.0.1:3101", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + VPS_EXEC_TOKEN }, body: JSON.stringify(payload) });
      var data = await r.json();
      if (data.success) { var msgs = { post_tweet: "✅ 推文已发布", like_tweet: "❤️ 已点赞", retweet: "🔁 已转发", reply_tweet: "💬 已回复", update_x_profile: "✅ 已更新" }; return { content: [{ type: "text", text: msgs[name] }] }; }
      return { content: [{ type: "text", text: "❌ 失败: " + (data.error || "unknown") }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Weibo
  if (name === "read_weibo_timeline") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/weibo/timeline", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ username: args.username || "", count: args.count || 10 }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法读取微博: " + data.error }] };
      return { content: [{ type: "text", text: "📱 微博时间线:\n\n" + data.data.content }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "post_weibo") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/weibo/post", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ text: args.text }) });
      var data = await r.json(); return { content: [{ type: "text", text: data.success ? "✅ 微博已发送" : "❌ 发送失败: " + data.error }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "read_weibo_post") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/weibo/read", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ url: args.url }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法读取: " + data.error }] };
      return { content: [{ type: "text", text: data.data.content }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Xiaohongshu
  if (name === "read_xiaohongshu") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/xhs/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ query: args.query, note_url: args.note_url }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法访问小红书: " + data.error }] };
      return { content: [{ type: "text", text: "📕 小红书:\n\n" + data.data.content }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "read_xiaohongshu_profile") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/xhs/profile", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ user_url: args.user_url }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法访问: " + data.error }] };
      return { content: [{ type: "text", text: "📕 小红书用户:\n\n" + data.data.content }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Meituan
  if (name === "search_meituan_food") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/meituan/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ query: args.query }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法搜索美团: " + data.error }] };
      return { content: [{ type: "text", text: "🍜 美团外卖搜索: " + args.query + "\n\n" + data.data.content }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Amap (高德地图)
  if (name === "amap_search_poi") {
    try {
      var url = "https://restapi.amap.com/v3/place/text?key=" + AMAP_KEY + "&keywords=" + encodeURIComponent(args.keywords) + "&offset=10" + (args.city ? "&city=" + encodeURIComponent(args.city) : "");
      var r = await fetch(url); var data = await r.json();
      if (data.status !== "1") return { content: [{ type: "text", text: "搜索失败: " + (data.info || "unknown") }] };
      var pois = (data.pois || []).map((p, i) => (i + 1) + ". " + p.name + "\n   地址: " + p.address + "\n   坐标: " + p.location + (p.tel ? "\n   电话: " + p.tel : "") + (p.type ? "\n   类型: " + p.type : "")).join("\n\n");
      return { content: [{ type: "text", text: "📍 高德搜索: " + args.keywords + (args.city ? " (" + args.city + ")" : "") + "\n\n" + (pois || "没有找到") }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "amap_geocode") {
    try {
      var url = "https://restapi.amap.com/v3/geocode/geo?key=" + AMAP_KEY + "&address=" + encodeURIComponent(args.address) + (args.city ? "&city=" + encodeURIComponent(args.city) : "");
      var r = await fetch(url); var data = await r.json();
      if (data.status !== "1" || !data.geocodes?.length) return { content: [{ type: "text", text: "未找到地址" }] };
      var g = data.geocodes[0];
      return { content: [{ type: "text", text: "📍 " + g.formatted_address + "\n坐标: " + g.location + "\n区域: " + g.province + g.city + g.district }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "amap_route") {
    try {
      var mode = args.mode || "driving";
      var baseUrl = mode === "walking" ? "https://restapi.amap.com/v3/direction/walking" : mode === "transit" ? "https://restapi.amap.com/v3/direction/transit/integrated" : "https://restapi.amap.com/v3/direction/driving";
      var url = baseUrl + "?key=" + AMAP_KEY + "&origin=" + encodeURIComponent(args.origin) + "&destination=" + encodeURIComponent(args.destination) + (args.city ? "&city=" + encodeURIComponent(args.city) : "");
      var r = await fetch(url); var data = await r.json();
      if (data.status !== "1") return { content: [{ type: "text", text: "路线规划失败: " + (data.info || "unknown") }] };
      var route = data.route;
      if (mode === "driving" && route?.paths?.length) {
        var p = route.paths[0];
        return { content: [{ type: "text", text: "🚗 驾车路线\n距离: " + (p.distance / 1000).toFixed(1) + "km\n预计时间: " + Math.round(p.duration / 60) + "分钟\n路线: " + p.steps.map(s => s.instruction).join(" → ") }] };
      }
      if (mode === "walking" && route?.paths?.length) {
        var p = route.paths[0];
        return { content: [{ type: "text", text: "🚶 步行路线\n距离: " + p.distance + "m\n预计时间: " + Math.round(p.duration / 60) + "分钟" }] };
      }
      if (mode === "transit" && route?.transits?.length) {
        var t = route.transits[0];
        return { content: [{ type: "text", text: "🚌 公交路线\n距离: " + (t.distance / 1000).toFixed(1) + "km\n预计时间: " + Math.round(t.duration / 60) + "分钟\n费用: " + t.cost + "元\n路线: " + t.segments.map(s => s.bus?.buslines?.[0]?.name || "步行").join(" → ") }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data).substring(0, 2000) }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "amap_weather") {
    try {
      // First geocode city to get adcode
      var gUrl = "https://restapi.amap.com/v3/geocode/geo?key=" + AMAP_KEY + "&address=" + encodeURIComponent(args.city);
      var gR = await fetch(gUrl); var gData = await gR.json();
      var adcode = gData.geocodes?.[0]?.adcode || "";
      if (!adcode) return { content: [{ type: "text", text: "未找到城市: " + args.city }] };
      var url = "https://restapi.amap.com/v3/weather/weatherInfo?key=" + AMAP_KEY + "&city=" + adcode + "&extensions=base";
      var r = await fetch(url); var data = await r.json();
      if (data.status !== "1" || !data.lives?.length) return { content: [{ type: "text", text: "天气查询失败" }] };
      var w = data.lives[0];
      return { content: [{ type: "text", text: "🌤️ " + w.province + w.city + "\n天气: " + w.weather + "\n温度: " + w.temperature + "°C\n风向: " + w.winddirection + " " + w.windpower + "级\n湿度: " + w.humidity + "%" }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Taobao
  if (name === "search_taobao") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/taobao/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ query: args.query }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "搜索失败: " + data.error }] };
      var out = "🛒 淘宝搜索: " + args.query + "\n\n" + data.data.content;
      if (data.data.links?.length) out += "\n\n商品链接:\n" + data.data.links.map(l => "- " + l.text + "\n  " + l.href).join("\n");
      return { content: [{ type: "text", text: out.substring(0, 15000) }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "browse_taobao_item") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/taobao/item", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ item_url: args.item_url }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法打开商品: " + data.error }] };
      return { content: [{ type: "text", text: "📦 商品详情:\n\n" + data.data.content.substring(0, 15000) }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "taobao_add_to_cart") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/taobao/add-to-cart", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ item_url: args.item_url }) });
      var data = await r.json();
      if (data.success) return { content: [{ type: "text", text: "✅ 已加入购物车！请在淘宝确认付款。" }] };
      return { content: [{ type: "text", text: "❌ " + data.error }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Uber Eats
  if (name === "search_ubereats") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/ubereats/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ query: args.query }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法搜索Uber Eats: " + data.error }] };
      var out = "🍔 Uber Eats 搜索: " + args.query + "\n\n" + data.data.content;
      if (data.data.links?.length) out += "\n\n餐厅链接:\n" + data.data.links.map(l => "- " + l.text + "\n  " + l.href).join("\n");
      return { content: [{ type: "text", text: out.substring(0, 15000) }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "browse_ubereats_store") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/ubereats/store", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ store_url: args.store_url }) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法打开餐厅: " + data.error }] };
      return { content: [{ type: "text", text: "🍽️ 菜单:\n\n" + data.data.content.substring(0, 15000) }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "ubereats_add_to_cart") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/ubereats/add-to-cart", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({ item_name: args.item_name, store_url: args.store_url }) });
      var data = await r.json();
      if (data.success) return { content: [{ type: "text", text: "✅ 已加入购物车: " + args.item_name }] };
      return { content: [{ type: "text", text: "❌ 加入失败: " + data.error }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }
  if (name === "ubereats_checkout") {
    try {
      var r = await fetch(PLAYWRIGHT_API_URL + "/ubereats/checkout", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PLAYWRIGHT_API_KEY }, body: JSON.stringify({}) });
      var data = await r.json(); if (!data.success) return { content: [{ type: "text", text: "无法查看购物车: " + data.error }] };
      return { content: [{ type: "text", text: "🛒 订单详情（请确认后告诉我是否下单）:\n\n" + data.data.content.substring(0, 10000) + "\n\n⚠️ 我不会自动下单，请你确认后告诉我。" }] };
    } catch (e) { return { content: [{ type: "text", text: "错误: " + e.message }] }; }
  }

  // Phone status
  if (name === "get_phone_status") {
    var r = await fetch("http://127.0.0.1:8800/api/phone"); var data = await r.json();
    var recent = data.slice(0, args.limit || 5);
    if (!recent.length) return { content: [{ type: "text", text: "暂无数据" }] };
    return { content: [{ type: "text", text: recent.map(s => { var p = [s.time?.replace("T", " ").slice(0, 19)]; if (s.battery) p.push("电量: " + s.battery); if (s.note) p.push(s.note); return p.join(" | "); }).join("\n") }] };
  }
  if (name === "get_screenshots") {
    var r = await fetch("http://127.0.0.1:8800/api/screenshot"); var data = await r.json();
    if (!data.length) return { content: [{ type: "text", text: "暂无截图" }] };
    return { content: [{ type: "text", text: data.map(s => s.time.slice(0, 19).replace("T", " ") + " - " + s.note + "\nURL: https://chat.viraelandnoeforever.com/api/screenshot/" + s.filename).join("\n\n") }] };
  }

  return { content: [{ type: "text", text: "Unknown tool" }] };
}

// === HTTP Server ===
const PORT = 4000;
http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.writeHead(200).end();
  if (req.method === "GET") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", tools: tools.length }));
  if (req.method === "POST") {
    var body = ""; req.on("data", c => body += c); req.on("end", async () => {
      try {
        var { method, id, params } = JSON.parse(body);
        if (method === "initialize") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "noe-mcp-gateway", version: "3.0.0" }, capabilities: { tools: {} } } }));
        if (method === "tools/list") return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result: { tools } }));
        if (method === "tools/call") {
          try {
            var result = await executeTool(params.name, params.arguments || {});
            return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result }));
          } catch (e) {
            return res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "错误: " + e.message }] } }));
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id, result: {} }));
      } catch (e) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message })); }
    });
  } else { res.writeHead(405).end(); }
}).listen(PORT, () => console.log("MCP server running on port " + PORT));
