import http from 'node:http';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
http.createServer(async(req,res)=>{const name=req.url==='/renderer.js'?'src/renderer.js':req.url==='/'?'preview.html':null;if(!name){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');res.end(await fs.readFile(new URL(name,root)));}).listen(9841,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:9841'));
