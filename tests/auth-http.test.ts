import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

async function freePort(){
 const socket=createServer();
 socket.listen(0,'127.0.0.1');await once(socket,'listening');
 const addr=socket.address();if(!addr||typeof addr==='string')throw Error('No test port');
 socket.close();await once(socket,'close');return addr.port;
}
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('named staff sessions protect API, enforce roles and attribute custody history', {timeout:20000},async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'maple-auth-'));
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(new URL('../server.ts',import.meta.url))],{
  env:{...process.env,MAPLE_DATA_DIR:dataDir,PORT:String(port),
   MAPLE_CLERK_PASSWORD:'testing-clerk-password',
   MAPLE_MANAGER_PASSWORD:'testing-manager-password',
   MAPLE_AUDITOR_PASSWORD:'testing-auditor-password'},stdio:['ignore','pipe','pipe']
 });
 let logs='';child.stdout.on('data',(x:Buffer)=>logs+=x.toString());child.stderr.on('data',(x:Buffer)=>logs+=x.toString());
 type Session={cookie:string;csrf:string;staff:{name:string;role:string}};
 async function signIn(login:string,password:string):Promise<Session>{
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({login,password})});
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));
  const cookie=response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('mm_session='));
  assert.match(response.headers.get('set-cookie')||'',/HttpOnly; SameSite=Strict/);
  return {cookie,csrf:body.csrf,staff:body.staff};
 }
 async function get(session:Session,path:string){return fetch(base+'/api/'+path,{headers:{Cookie:session.cookie}})}
 async function post(session:Session,path:string,data:unknown,csrf=session.csrf){
  return fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:session.cookie,'X-CSRF-Token':csrf},body:JSON.stringify(data)});
 }
 try{
  let ready=false;
  for(let i=0;i<100;i++){
   if(child.exitCode!==null)throw Error('Demo server exited: '+logs);
   try{if((await fetch(base+'/api/state')).status===401){ready=true;break}}catch{}
   await sleep(80);
  }
  assert.ok(ready,'Authentication-protected server started: '+logs);
  assert.equal((await fetch(base+'/api/state')).status,401);
  assert.equal((await fetch(base+'/api/export')).status,401);
  const bad=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({login:'alex',password:'wrong'})});
  assert.equal(bad.status,401);
  const clerk=await signIn('alex','testing-clerk-password');
  const manager=await signIn('morgan','testing-manager-password');
  const auditor=await signIn('casey','testing-auditor-password');
  assert.equal(clerk.staff.role,'clerk');
  assert.equal(manager.staff.role,'manager');
  assert.equal(auditor.staff.role,'auditor');
  assert.equal((await get(clerk,'state')).status,200);
  assert.equal((await get(auditor,'state')).status,200);
  assert.equal((await get(clerk,'export')).status,403);
  assert.equal((await get(manager,'export')).status,200);
  assert.equal((await get(auditor,'export')).status,200);
  const state=await (await get(manager,'state')).json();
  assert.equal((await post(clerk,'customer',{...state.customers[0]},'incorrect-csrf')).status,403);
  assert.equal((await post(clerk,'customer',{...state.customers[0]})).status,403);
  assert.equal((await post(auditor,'intake',{tracking:'NO',location:'l1'})).status,403);
  assert.equal((await post(clerk,'change',{id:'i6',reason:'Unauthorized correction'})).status,403);
  assert.equal((await post(clerk,'reset',{confirm:'RESET DEMO'})).status,403);
  assert.equal((await post(manager,'customer',{...state.customers[0],language:'en'})).status,200);
  const created=await post(manager,'authorization',{customerId:'c1',name:'Temporary delegate',reason:'Consent confirmed',expiresAt:new Date(Date.now()+3600000).toISOString()});
  assert.equal(created.status,200);
  const authorization=await created.json();
  assert.equal((await post(clerk,'revoke',{id:authorization.id,reason:'Customer rescinded access'})).status,403);
  assert.equal((await post(auditor,'revoke',{id:authorization.id,reason:'Customer rescinded access'})).status,403);
  assert.equal((await post(manager,'revoke',{id:authorization.id,reason:''})).status,400);
  const revoked=await post(manager,'revoke',{id:authorization.id,reason:'Customer rescinded access'});
  assert.equal(revoked.status,200);
  assert.equal((await revoked.json()).revoked,true);
  assert.equal((await post(manager,'revoke',{id:authorization.id,reason:'Again'})).status,400);
  const intake=await post(clerk,'intake',{tracking:'RBAC-TEST-001',carrier:'USPS',type:'package',location:'l1',customerId:'c1',name:'Maria Garcia',confirmed:true,evidence:'Clerk compared mailbox and customer record'});
  assert.equal(intake.status,200);
  const item=await intake.json();
  let history=await (await get(manager,'history/'+item.id)).json();
  assert.ok(history.some((e:any)=>e.kind==='received'&&e.staff.includes('Alex Rivera (staff-alex)')));
  const correction=await post(manager,'change',{id:item.id,location:'l2',reason:'Manager verified storage location'});
  assert.equal(correction.status,200,JSON.stringify(await correction.json()));
  assert.equal((await post(auditor,'pickup',{id:item.id,check:'Photo ID checked'})).status,403);
  const pickup=await post(clerk,'pickup',{id:item.id,check:'Photo ID checked'});
  assert.equal(pickup.status,200);
  history=await (await get(manager,'history/'+item.id)).json();
  assert.ok(history.some((e:any)=>e.kind==='correction'&&e.staff.includes('Morgan Lee (staff-morgan)')));
  assert.ok(history.some((e:any)=>e.kind==='collected'&&e.staff.includes('Alex Rivera (staff-alex)')));
  const problemIntake=await post(clerk,'intake',{
   tracking:'INCIDENT-HTTP-01',carrier:'USPS',type:'package',location:'l1',
   customerId:'c1',name:'Maria Garcia',confirmed:true,evidence:'Original mailbox verified'
  });
  assert.equal(problemIntake.status,200);
  const problemItem=await problemIntake.json();
  const current=await (await get(manager,'state')).json();
  const outgoing=current.drafts.find((d:any)=>d.itemId===problemItem.id&&d.status==='queued');
  assert.ok(outgoing);
  const attemptResponse=await post(clerk,'send',{id:outgoing.id});
  assert.equal(attemptResponse.status,200);
  assert.equal((await attemptResponse.json()).status,'simulated');
  const correctedResponse=await post(manager,'change',{
   id:problemItem.id,customerId:'c3',confirmed:true,reason:'Manager verified wrong prior recipient'
  });
  assert.equal(correctedResponse.status,200);
  assert.equal((await correctedResponse.json()).state,'exception');
  const afterCorrection=await (await get(manager,'state')).json();
  const incident=afterCorrection.incidents.find((i:any)=>i.itemId===problemItem.id);
  assert.ok(incident);
  assert.equal(incident.status,'open');
  assert.equal(afterCorrection.drafts.filter((d:any)=>d.itemId===problemItem.id&&d.status==='queued').length,0);
  const review={id:incident.id,disposition:'demo_only_no_delivery',notes:'Only simulated locally; no SMS or email'};
  assert.equal((await post(clerk,'incident',review)).status,403);
  assert.equal((await post(auditor,'incident',review)).status,403);
  assert.equal((await post(manager,'incident',review,'bad-csrf')).status,403);
  assert.equal((await post(manager,'incident',{...review,notes:''})).status,400);
  assert.equal((await post(manager,'change',{id:problemItem.id,state:'available',confirmed:true,reason:'Premature release'})).status,400);
  const approved=await post(manager,'incident',review);
  assert.equal(approved.status,200);
  assert.equal((await approved.json()).status,'reviewed');
  assert.equal((await post(manager,'incident',review)).status,400);
  assert.equal((await post(manager,'change',{id:problemItem.id,state:'available',reason:'No reconfirmation'})).status,400);
  const released=await post(manager,'change',{
    id:problemItem.id,state:'available',confirmed:true,reason:'Reverified mailbox 103 before release'
  });
  assert.equal(released.status,200);
  assert.equal((await released.json()).state,'available');
  const finalState=await (await get(manager,'state')).json();
  assert.equal(finalState.drafts.filter((d:any)=>d.itemId===problemItem.id&&d.status==='queued'&&d.customerId==='c3').length,1);
  const incidentHistory=await (await get(manager,'history/'+problemItem.id)).json();
  assert.ok(incidentHistory.some((e:any)=>e.kind==='recipient notification incident opened'));
  assert.ok(incidentHistory.some((e:any)=>e.kind==='recipient notification incident reviewed'&&e.staff.includes('Morgan Lee')));
  assert.equal((await post(clerk,'logout',{})).status,200);
  assert.equal((await get(clerk,'state')).status,401);
  assert.equal((await get(manager,'state')).status,200);
 }finally{
  child.kill();
  if(child.exitCode===null)await Promise.race([once(child,'exit'),sleep(2000)]);
  rmSync(dataDir,{recursive:true,force:true});
 }
});
