import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlNiS4AAAAASUVORK5CYII=';

async function openPort(): Promise<number> {
  const listener=createServer();
  listener.listen(0,'127.0.0.1');
  await once(listener,'listening');
  const address=listener.address();
  if (!address || typeof address==='string') throw Error('Could not allocate test port');
  const port=address.port;
  listener.close();
  await once(listener,'close');
  return port;
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('HTTP label upload rejects misleading bytes and stores a validated-format demo label', {timeout:20000}, async()=>{
  const dataDir=mkdtempSync(join(tmpdir(),'maple-http-upload-'));
  const port=await openPort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../server.ts',import.meta.url))],{
    env:{...process.env,MAPLE_DATA_DIR:dataDir,PORT:String(port),MAPLE_CLERK_PASSWORD:'ci-clerk-password'},stdio:['ignore','pipe','pipe']
  });
  let log='';
  child.stderr.on('data',(b:Buffer)=>{log+=b.toString()});
  child.stdout.on('data',(b:Buffer)=>{log+=b.toString()});
  let cookie='',csrf='';
  const get=(path:string)=>fetch(base+path,{headers:{Cookie:cookie}});
  const upload=async(data:any)=>fetch(base+'/api/upload',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:cookie,'X-CSRF-Token':csrf},
    body:JSON.stringify({data})
  });
  try {
    let ready=false;
    for(let i=0;i<75;i++){
      if(child.exitCode!==null)throw Error('Server exited: '+log);
      try{const response=await get('/api/state');if(response.status===401){ready=true;break}}catch{}
      await sleep(80);
    }
    if(!ready)throw Error('Server not ready: '+log);
    assert.equal((await fetch(base+'/api/state')).status,401);
    const login=await fetch(base+'/api/login',{
      method:'POST',headers:{'Content-Type':'application/json',Origin:base},
      body:JSON.stringify({login:'alex',password:'ci-clerk-password'})
    });
    assert.equal(login.status,200);cookie=login.headers.get('set-cookie')!.split(';')[0];
    csrf=(await login.json()).csrf;
    const initial=await (await get('/api/state')).json();
    assert.equal(initial.labels.length,10);
    assert.equal((await upload('data:image/png;base64,'+Buffer.from('not an image').toString('base64'))).status,400);
    assert.equal((await upload('data:image/jpeg;base64,'+tinyPng)).status,400);
    assert.equal((await upload('data:image/png;base64,@@@@')).status,400);
    let state=await (await get('/api/state')).json();
    assert.equal(state.labels.length,10,'Bad uploads cannot create label records');
    assert.equal(readdirSync(dataDir).filter(n=>/\.(png|jpeg|webp)$/.test(n)).length,0,'Bad uploads cannot create files');
    const response=await upload('data:image/png;base64,'+tinyPng);
    const label=await response.json();
    assert.equal(response.status,200,JSON.stringify(label));
    assert.equal(label.mediaType,'image/png');
    assert.deepEqual([label.width,label.height],[1,1]);
    const imageResponse=await get(label.url);
    assert.equal(imageResponse.status,200);
    assert.equal(imageResponse.headers.get('content-type'),'image/png');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()),Buffer.from(tinyPng,'base64'));
    state=await (await get('/api/state')).json();
    assert.equal(state.labels.length,11);
    assert.equal(readdirSync(dataDir).filter(n=>n.endsWith('.png')).length,1);
  }finally{
    child.kill();
    if(child.exitCode===null)await Promise.race([once(child,'exit'),sleep(2000)]);
    rmSync(dataDir,{recursive:true,force:true});
  }
});
