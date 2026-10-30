import {createServer} from 'node:http';
import {readFileSync,existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {database,repository,org} from './db.ts';
import {service} from './domain.ts';
import {seed} from './seed.ts';
import {decodeLabelImageDataUrl} from './label-image.ts';
const root=dirname(fileURLToPath(import.meta.url));mkdirSync(resolve(root,'data'),{recursive:true});
const db=database(resolve(root,'data/maple.sqlite'));const r=repository(db),s=service(r);seed(r,s);
for(let n=1;n<=10;n++){const path=resolve(root,`public/labels/label${n}.svg`);if(!existsSync(path))writeFileSync(path,`<svg xmlns="http://www.w3.org/2000/svg" width="680" height="360"><rect width="680" height="360" fill="#faf9f4"/><g fill="#172b29" font-family="monospace"><text x="32" y="48" font-size="18">SYNTHETIC LABEL • OUTSIDE ONLY</text><text x="32" y="115" font-size="32">${n===1?'Maria Garcia':n<=5?'[UNREADABLE RECIPIENT]':r.list('customer')[n-1].name}</text><text x="32" y="165" font-size="22">${n<=5?'MAILBOX: ?':'MAILBOX: '+(100+n)}</text><text x="32" y="222" font-size="22">9400 1000 0000 ${999+n}</text><text x="32" y="300" font-size="16">DEMO · NOT A REAL SHIPMENT</text></g></svg>`)}
const json=(res:any,v:any,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(v))};
createServer(async(req,res)=>{try{if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||''))throw Error('Local workstation host required');const u=new URL(req.url!,'http://localhost');if(req.method==='GET'&&u.pathname==='/api/state')return json(res,{org,staff:'Alex Rivera',timezone:'America/New_York',customers:r.list('customer'),items:r.list('item'),locations:r.list('location'),drafts:r.list('draft'),attempts:r.list('attempt'),labels:r.list('label'),ocr:r.list('ocr'),authorizations:r.list('authorization'),settings:r.get('settings','retention')});
 if(req.method==='GET'&&u.pathname.startsWith('/api/history/'))return json(res,r.history(u.pathname.split('/').pop()!));
 if(req.method==='GET'&&u.pathname==='/api/export'){const rows=[['item','tracking','recipient','state','arrived UTC','collected UTC','location'],...r.list('item').map((i:any)=>[i.id,i.tracking,r.get('customer',i.customerId)?.name||'Review',i.state,i.arrivedAt,i.collectedAt||'',r.get('location',i.location)?.name])];res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="maple-intake-pickup.csv"'});return res.end(rows.map(row=>row.map((v:any)=>'"'+String(v).replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"').join(',')).join('\r\n'))}
 if(req.method==='POST'&&u.pathname.startsWith('/api/')){if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw Error('Cross-origin write rejected');let body='';for await(const chunk of req){body+=chunk;if(body.length>3000000)throw Error('Upload too large (2 MB maximum)')}const p=JSON.parse(body||'{}');
 switch(u.pathname){case '/api/match':return json(res,s.candidates(p));case '/api/intake':return json(res,s.intake(p));case '/api/change':return json(res,s.change(p.id,p));case '/api/pickup':return json(res,s.pickup(p.id,p));case '/api/send':return json(res,s.send(p.id));
 case '/api/customer':return json(res,s.saveCustomer(p));
 case '/api/authorization':{if(!r.get('customer',p.customerId)||!p.name?.trim()||!p.reason?.trim()||!p.expiresAt||!Number.isFinite(Date.parse(p.expiresAt))||Date.parse(p.expiresAt)<=Date.now())throw Error('Customer, third-party name, verification evidence and future expiry required');const a=r.put('authorization',{id:randomUUID(),customerId:p.customerId,name:p.name,reason:p.reason,expiresAt:new Date(p.expiresAt).toISOString(),staff:'Alex Rivera'});r.event('','pickup authorization created',a);return json(res,a)}
 case '/api/upload':{
  const image=decodeLabelImageDataUrl(p.data);
  const id=randomUUID(),filename=`${id}.${image.extension}`,filepath=resolve(root,'data',filename);
  writeFileSync(filepath,image.bytes,{flag:'wx',mode:0o600});
  try {
   const label=r.transaction(()=>{
    const createdAt=new Date().toISOString();
    const record=r.put('label',{id,url:`/image/${id}`,file:filename,mediaType:image.mime,width:image.width,height:image.height,createdAt,expiresAt:new Date(Date.now()+r.get('settings','retention').days*86400000).toISOString()});
    r.put('ocr',{id:randomUUID(),labelId:id,status:'unavailable',suggestions:{},raw:'',provider:'No OCR adapter configured; use manual entry'});
    r.event('','label uploaded',{labelId:id,mime:image.mime,bytes:image.bytes.length,width:image.width,height:image.height});
    return record;
   });
   return json(res,label);
  }catch(error){if(existsSync(filepath))unlinkSync(filepath);throw error}
 }
 case '/api/purge':{let count=0;for(const l of r.list('label'))if(l.expiresAt<new Date().toISOString()&&!l.deletedAt){if(l.file&&existsSync(resolve(root,'data',l.file)))unlinkSync(resolve(root,'data',l.file));l.deletedAt=new Date().toISOString();r.put('label',l);r.event('','label deleted',{labelId:l.id});count++}return json(res,{count})}
 case '/api/retention':{if(!Number.isInteger(p.days)||p.days<1||p.days>90)throw Error('Retention must be 1–90 days');r.put('settings',{id:'retention',days:p.days});r.event('','retention changed',{days:p.days});return json(res,{ok:true})}
 case '/api/reset':{if(p.confirm!=='RESET DEMO')throw Error('Type RESET DEMO');r.transaction(()=>{for(const l of r.list('label'))if(l.file&&existsSync(resolve(root,'data',l.file))){unlinkSync(resolve(root,'data',l.file));r.event('','label deleted during demo reset',{labelId:l.id})}db.prepare('DELETE FROM records WHERE org=?').run(org);r.event('','demo reset',{reason:'Operator requested reset; prior audit remains'});seed(r,s)});return json(res,{ok:true})}
 default:throw Error('Unknown action')}}
 let path=resolve(root,'public',u.pathname==='/'?'index.html':'.'+u.pathname);let type=path.endsWith('.svg')?'image/svg+xml':path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html';if(u.pathname.startsWith('/image/')){const l=r.get('label',u.pathname.split('/').pop()!);if(!l||l.deletedAt||l.expiresAt<new Date().toISOString())throw Error('Label expired or unavailable');path=resolve(root,'data',l.file);type='image/'+l.file.split('.').pop()}
 else if(!path.startsWith(resolve(root,'public')+'/'))throw Error('Invalid path');const bytes=readFileSync(path);res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'"});res.end(bytes);
 }catch(e:any){json(res,{error:e.message},400)}}).listen(Number(process.env.PORT||4317),'127.0.0.1',()=>console.log('Maple Mail Center: http://localhost:'+ (process.env.PORT||4317)));
