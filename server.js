#!/usr/bin/env node
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);
const MAX_BODY = 5 * 1024 * 1024;
const MIME = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };
function send(res, status, data, type='application/json; charset=utf-8') { res.writeHead(status, {'Content-Type':type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}); res.end(typeof data === 'string' ? data : JSON.stringify(data)); }
function readBody(req) { return new Promise((resolve,reject)=>{let chunks=[],size=0; req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('Input too large (max 5 MB)'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))}catch{reject(new Error('Invalid JSON body'));}});req.on('error',reject);}); }
function safeName(s) { return path.basename(String(s || 'input.lua')).replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.(lua|luau|txt)$/i,'') + '.lua'; }
const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res,200,{ok:true});
  if (req.method === 'POST' && url.pathname === '/api/deobfuscate') {
    let body; try { body = await readBody(req); } catch(e) { return send(res,400,{error:e.message}); }
    if (typeof body.source !== 'string' || !body.source.trim()) return send(res,400,{error:'Input Lua/Luau code is empty.'});
    if (Buffer.byteLength(body.source,'utf8') > MAX_BODY) return send(res,413,{error:'Input too large (max 5 MB).'});
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'luraph-ui-'));
    const input = path.join(dir,safeName(body.filename)); const output = path.join(dir,'result.deobf.luau');
    try {
      fs.writeFileSync(input,body.source,'utf8');
      const child = spawn(process.execPath,[path.join(ROOT,'deob.js'),input,'-o',output],{cwd:ROOT,windowsHide:true});
      let stdout='',stderr='',done=false;
      child.stdout.on('data',d=>stdout+=d.toString()); child.stderr.on('data',d=>stderr+=d.toString());
      const timeout = setTimeout(()=>{if(!done) child.kill('SIGKILL');},120000);
      child.on('error',err=>{done=true;clearTimeout(timeout);cleanup();send(res,500,{error:'Could not start deobfuscator: '+err.message});});
      child.on('close',code=>{if(done)return;done=true;clearTimeout(timeout);try{
        if(fs.existsSync(output)){const result=fs.readFileSync(output,'utf8');cleanup();return send(res,200,{ok:true,output:result,log:(stdout+'\n'+stderr).trim(),filename:path.basename(output)});}
        const message=(stderr||stdout||'Deobfuscation failed without output.').trim(); cleanup(); return send(res,422,{error:message,log:message,exitCode:code});
      }catch(err){cleanup();send(res,500,{error:err.message});}});
      function cleanup(){try{fs.rmSync(dir,{recursive:true,force:true});}catch{}}
    } catch(e) { try{fs.rmSync(dir,{recursive:true,force:true});}catch{} return send(res,500,{error:e.message}); }
    return;
  }
  if (req.method === 'GET') {
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(PUBLIC,rel);
    if (!target.startsWith(PUBLIC + path.sep) && target !== path.join(PUBLIC,'index.html')) return send(res,403,'Forbidden','text/plain; charset=utf-8');
    fs.readFile(target,(err,data)=>{if(err)return send(res,404,'Not found','text/plain; charset=utf-8');res.writeHead(200,{'Content-Type':MIME[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(data);});
    return;
  }
  send(res,404,{error:'Not found'});
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Luraph UI ready at http://localhost:${PORT}`));
