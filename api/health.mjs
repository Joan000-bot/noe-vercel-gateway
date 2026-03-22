export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;
  let spotifyResult = "no env vars";
  if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET && SPOTIFY_REFRESH_TOKEN) {
    try {
      const r = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(SPOTIFY_CLIENT_ID + ":" + SPOTIFY_CLIENT_SECRET).toString("base64")
        },
        body: "grant_type=refresh_token&refresh_token=" + SPOTIFY_REFRESH_TOKEN
      });
      const data = await r.json();
      spotifyResult = data;
    } catch (e) {
      spotifyResult = "error: " + e.message;
    }
  }
  res.json({ spotifyResult });
}
