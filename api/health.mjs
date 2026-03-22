export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({
    status: "ok",
    message: "火还在烧着 🔥",
    env_check: {
      NOTION_TOKEN: !!process.env.NOTION_TOKEN,
      SPOTIFY_CLIENT_ID: !!process.env.SPOTIFY_CLIENT_ID,
      SPOTIFY_CLIENT_SECRET: !!process.env.SPOTIFY_CLIENT_SECRET,
      SPOTIFY_REFRESH_TOKEN: !!process.env.SPOTIFY_REFRESH_TOKEN
    }
  });
}
