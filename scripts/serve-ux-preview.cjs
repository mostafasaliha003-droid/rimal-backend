// Isolated frontend review host. It never runs server.js or financial writes.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

const directory = path.resolve(process.env.REMAL_UX_DIST || path.join(__dirname, '..', 'frontend', 'dist'));
const port = Number(process.env.PORT || 5178);
const host = process.env.REMAL_UX_BIND || '127.0.0.1';
const apiOrigin = 'https://rimal-api.onrender.com';
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.txt':'text/plain; charset=utf-8', '.xml':'application/xml', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.avif':'image/avif', '.woff2':'font/woff2', '.woff':'font/woff', '.ico':'image/x-icon' };
const cached = new Map();
const readMethods = new Set(['GET', 'HEAD']);
const allowedApi = (method, pathname) => method === 'GET'
    ? /^\/api\/(?:display-rates|search\/suggest|search\/sort\/\d+|v1\/hotels\/\d+|affiliate\/availability)$/.test(pathname)
    : method === 'POST' && /^\/api\/(?:search\/(?:rates(?:\/(?:region|geo))?|hotelpage)|booking\/prebook(?:-serp)?|affiliate\/hotels\/\d+\/rates)$/.test(pathname);

function json(response, status, value) {
    response.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
    response.end(JSON.stringify(value));
}
async function requestBody(request) {
    const chunks=[];let length=0;
    for await(const chunk of request){length+=chunk.length;if(length>131072)throw Object.assign(new Error('Body too large'),{status:413});chunks.push(chunk)}
    return Buffer.concat(chunks);
}
async function proxy(request, response, url) {
    if(url.pathname === '/api/payment/availability' && request.method === 'GET') {
        return json(response,200,{enabled:false,reason:'UX_REVIEW_READ_ONLY'});
    }
    if(!allowedApi(request.method,url.pathname))return json(response,405,{error:'UX_REVIEW_READ_ONLY',message:'This review environment does not submit accounts, bookings, or payments.'});
    const upstream = await fetch(apiOrigin+url.pathname+url.search,{
        method:request.method,
        headers:{Accept:'application/json',...(request.method==='POST'?{'Content-Type':'application/json'}:{})},
        ...(request.method==='POST'?{body:await requestBody(request)}:{}),
        signal:AbortSignal.timeout(80000), redirect:'error'
    });
    response.writeHead(upstream.status,{'Content-Type':'application/json','Cache-Control':'no-store'});
    response.end(Buffer.from(await upstream.arrayBuffer()));
}
async function fileResponse(request,response,url) {
    let pathname;
    try{pathname=decodeURIComponent(url.pathname)}catch{return json(response,400,{error:'INVALID_PATH'})}
    if(pathname.split('/').some(part=>part.startsWith('.')))return json(response,404,{error:'NOT_FOUND'});
    let file=path.resolve(directory,'.'+pathname);
    if(file!==directory&&!file.startsWith(directory+path.sep))return json(response,404,{error:'NOT_FOUND'});
    let stat;
    try{stat=await fs.stat(file);if(stat.isDirectory())throw new Error('directory')}catch{
        if(path.extname(pathname))return json(response,404,{error:'NOT_FOUND'});
        file=path.join(directory,'index.html');stat=await fs.stat(file);
    }
    let entry=cached.get(file);
    if(!entry||entry.mtime!==stat.mtimeMs){
        const data=await fs.readFile(file);
        const compressible=/\.(?:html|css|js|json|svg|xml|txt|webmanifest)$/.test(file);
        entry={mtime:stat.mtimeMs,data,etag:'"'+crypto.createHash('sha256').update(data).digest('hex').slice(0,24)+'"'};
        if(compressible){entry.br=zlib.brotliCompressSync(data);entry.gzip=zlib.gzipSync(data)}
        cached.set(file,entry);
    }
    const headers={'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Cache-Control':/[/\\]assets[/\\]/.test(file)?'public, max-age=31536000, immutable':'no-cache','ETag':entry.etag,'Vary':'Accept-Encoding'};
    if(request.headers['if-none-match']===entry.etag){response.writeHead(304,headers);return response.end()}
    const accepted=request.headers['accept-encoding']||'';
    const encoding=entry.br&&process.env.REMAL_UX_ENCODING!=='gzip'&&/\bbr\b/.test(accepted)?'br':entry.gzip&&/\bgzip\b/.test(accepted)?'gzip':null;
    const data=encoding?entry[encoding]:entry.data;
    if(encoding)headers['Content-Encoding']=encoding;
    headers['Content-Length']=data.length;
    response.writeHead(200,headers);response.end(request.method==='HEAD'?undefined:data);
}
const server=http.createServer(async(request,response)=>{
    try{
        const url=new URL(request.url,'http://localhost');
        if(url.pathname==='/healthz')return json(response,200,{status:'ok',mode:'frontend-review',revision:process.env.RENDER_GIT_COMMIT||null});
        if(url.pathname.startsWith('/api/'))return await proxy(request,response,url);
        if(!readMethods.has(request.method))return json(response,405,{error:'METHOD_NOT_ALLOWED'});
        await fileResponse(request,response,url);
    }catch(error){
        if(!response.headersSent)json(response,error.status||502,{error:'REVIEW_REQUEST_FAILED'});else response.end();
    }
});
server.listen(port,host,()=>console.log(`Frontend review: http://${host}:${port}; static directory ${directory}`));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
