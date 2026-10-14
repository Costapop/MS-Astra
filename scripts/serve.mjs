import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml' };
http.createServer(async(req,res)=>{
  try {
    const path=resolve(root, '.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if (path!==root && !path.startsWith(root+sep)) throw Error();
    const file=path===root?resolve(root,'index.html'):path;
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'}); res.end(body);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
