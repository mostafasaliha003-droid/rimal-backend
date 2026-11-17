/* global __dirname */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../.expo-preview/verified');
const port = Number(process.env.REMAL_MOBILE_PREVIEW_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid preview port.');
if (!fs.existsSync(path.join(root,'index.html'))) throw Error('Export the web preview first.');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json',
  '.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg',
  '.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon','.css':'text/css; charset=utf-8'};
const server = http.createServer((req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  let file;
  try { file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname)); }
  catch {res.writeHead(400);res.end();return;}
  if (file!==root && !file.startsWith(root+path.sep)) {res.writeHead(404);res.end();return;}
  if (file===root) file=path.join(root,'index.html');
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    if (path.extname(file)) {res.writeHead(404);res.end();return;}
    file=path.join(root,'index.html');
  }
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
});
server.listen(port,'127.0.0.1',()=>console.log(`Remal mobile web preview: http://127.0.0.1:${port}`));
