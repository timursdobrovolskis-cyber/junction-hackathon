import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import coach from './api/coach.js';
import calendar from './api/calendar.js';
import goals from './api/goals.js';
import budget from './api/budget.js';
const root=resolve('dist');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2'};
createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/budget'){await budget(req,res);return;}
    if(url.pathname==='/api/calendar'){await calendar(req,res);return;}
    if(url.pathname==='/api/goals'){await goals(req,res);return;}
    if(url.pathname==='/api/coach'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>120000){res.writeHead(413);res.end();return;}}
      req.body=body;await coach(req,res);return;
    }
    const path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/spendvest.html':url.pathname));
    if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const data=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(4174,'127.0.0.1',()=>console.log('Money preview: http://127.0.0.1:4174'));
