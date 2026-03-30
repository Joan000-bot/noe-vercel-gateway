#!/bin/bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
mkdir -p /root/exec-server
cat > /root/exec-server/index.mjs << 'SCRIPT'
import http from "http";
import { exec } from "child_process";

const TOKEN = "noe-exec-2026-secret";

http.createServer((req, res) => {
  if (req.method === "OPTIONS") { res.writeHead(200, {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"*"}); return res.end(); }
  if (req.url !== "/exec" || req.method !== "POST") { res.writeHead(404); return res.end("Not found"); }
  var auth = req.headers.authorization || "";
  if (auth !== "Bearer " + TOKEN) { res.writeHead(401); return res.end("Unauthorized"); }
  var body = "";
  req.on("data", c => body += c);
  req.on("end", () => {
    try {
      var j = JSON.parse(body);
      exec(j.command, { cwd: j.cwd || "/", timeout: 30000 }, (err, stdout, stderr) => {
        res.writeHead(200, {"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
        res.end(JSON.stringify({ stdout: stdout, stderr: stderr, error: err ? err.message : null }));
      });
    } catch(e) { res.writeHead(400); res.end("Bad request"); }
  });
}).listen(3456, () => console.log("exec server running on 3456"));
SCRIPT
npm install -g pm2
pm2 start /root/exec-server/index.mjs --name exec-server
pm2 save
pm2 startup
echo "===== done ====="
