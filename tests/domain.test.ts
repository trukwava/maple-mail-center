import test from 'node:test';import assert from 'node:assert/strict';import {database,repository} from '../db.ts';import {service} from '../domain.ts';import {seed} from '../seed.ts';
function setup(){const db=database(':memory:'),r=repository(db),s=service(r);seed(r,s);return {db,r,s}}
const input={tracking:'NEW123',carrier:'USPS',type:'package',location:'l1',customerId:'c1',confirmed:true,evidence:'Mailbox and record verified',name:'Maria Garcia'};
test('fixtures and ambiguous candidates',()=>{const {r,s}=setup();assert.equal(r.list('customer').length,30);assert.equal(r.list('item').length,50);assert.equal(r.list('location').length,6);assert.equal(r.list('label').length,10);assert.equal(s.candidates({name:'Maria Garcia'}).length,2)});
test('confirmation, inactive and duplicate gates',()=>{const {s}=setup();assert.throws(()=>s.intake({...input,confirmed:false}),/confirmation/);assert.throws(()=>s.intake({...input,customerId:'c5'}),/active/);s.intake(input);assert.throws(()=>s.intake(input),/Duplicate/);assert.ok(s.intake({...input,duplicateReason:'Carrier confirmed reused tracking label'}))});
test('review route recovers unreadable labels',()=>{const {s,r}=setup();const i=s.intake({...input,review:true,customerId:null});assert.equal(i.state,'exception');assert.equal(r.list('draft').filter((d:any)=>d.itemId===i.id).length,0);assert.equal(s.change(i.id,{customerId:'c3',confirmed:true,reason:'Mailbox 103 verified'}).state,'available')});
test('pickup only once; immutable events',async()=>{const {s,r,db}=setup();const i=s.intake(input);const results=await Promise.allSettled([Promise.resolve().then(()=>s.pickup(i.id,{check:'Photo ID checked'})),Promise.resolve().then(()=>s.pickup(i.id,{check:'Photo ID checked'}))]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.history(i.id).filter((e:any)=>e.kind==='collected').length,1);assert.throws(()=>db.exec('DELETE FROM events'),/immutable/)});
test('recipient correction supersedes draft and retains history',()=>{const {s,r}=setup();const i=s.intake(input);s.change(i.id,{customerId:'c3',confirmed:true,reason:'Corrected mailbox to 103'});const drafts=r.list('draft').filter((d:any)=>d.itemId===i.id);assert.equal(drafts.length,2);assert.equal(drafts.filter((d:any)=>d.status==='superseded').length,1);assert.equal(drafts.find((d:any)=>d.status==='queued').customerId,'c3');assert.ok(r.history(i.id).some((h:any)=>h.kind==='correction'))});
test('simulated and failed delivery remain distinct; replay stable',()=>{const {s,r}=setup();const i=s.intake(input);const d=r.list('draft').find((d:any)=>d.itemId===i.id);const a=s.send(d.id);assert.equal(a.status,'simulated');assert.deepEqual(s.send(d.id),a);const failure=r.list('attempt').find((a:any)=>a.status==='failed');assert.ok(failure);assert.equal(r.get('draft',failure.draftId).status,'failed')});
test('separate third-party authorization required',()=>{const {s,r}=setup();const i=s.intake(input);assert.throws(()=>s.pickup(i.id,{check:'Photo ID checked',thirdParty:true}),/authorization/);r.put('authorization',{id:'a1',customerId:'c1',name:'Delegate',expiresAt:new Date(Date.now()+86400000).toISOString()});assert.equal(s.pickup(i.id,{check:'Photo ID checked',thirdParty:true,authorizationId:'a1'}).state,'collected')});
test('org scoped records and message does not include internal notes',()=>{const {s,r,db}=setup();db.prepare('INSERT INTO records VALUES(?,?,?,?)').run('other','customer','private',JSON.stringify({id:'private'}));assert.equal(r.get('customer','private'),null);const i=s.intake({...input,condition:'SECRET INTERNAL NOTE'});const d=r.list('draft').find((d:any)=>d.itemId===i.id);assert.ok(!d.text.includes('SECRET'));assert.ok(!d.text.includes('Marina'))});

test('customer updates reject mailbox collisions and retain verified identity',()=>{
 const {s,r}=setup();
 const before=r.get('customer','c1');
 assert.throws(()=>s.saveCustomer({name:'Another Maria Garcia',mailbox:'101',language:'en',active:true}),/Mailbox already assigned/);
 assert.throws(()=>s.saveCustomer({...before,id:'nonexistent'}),/Customer not found/);
 assert.deepEqual(r.get('customer','c1'),before);
 const fresh=s.saveCustomer({name:'Maria Garcia',mailbox:'M-999',language:'en',aliases:'M. Garcia, M. Garcia',contact:'demo@example.invalid',active:true});
 assert.notEqual(fresh.id,'c1');
 assert.equal(fresh.aliases.length,1);
 assert.throws(()=>s.saveCustomer({...fresh,mailbox:'101'}),/Mailbox already assigned/);
 assert.equal(r.get('customer',fresh.id).mailbox,'M-999');
 const events=r.history('').filter((e:any)=>e.kind==='customer created');
 assert.ok(events.some((e:any)=>JSON.parse(e.data).customerId===fresh.id));
});

test('customer language change supersedes old drafts and regenerates in preferred language',()=>{
 const {s,r}=setup();
 const i=s.intake({...input,tracking:'LANG-CHANGE-1'});
 const old=r.list('draft').find((d:any)=>d.itemId===i.id);
 assert.equal(old.language,'es');
 const updated=s.saveCustomer({...r.get('customer','c1'),language:'en'});
 assert.equal(updated.language,'en');
 assert.equal(r.get('draft',old.id).status,'superseded');
 const next=r.list('draft').find((d:any)=>d.itemId===i.id&&d.id!==old.id);
 assert.equal(next.status,'queued');
 assert.equal(next.language,'en');
 assert.match(next.text,/Hello/);
 assert.throws(()=>s.send(old.id),/superseded/);
});

test('deactivation blocks pending notifications and reactivation creates new draft',()=>{
 const {s,r}=setup();
 const i=s.intake({...input,tracking:'INACTIVE-1'});
 const draft=r.list('draft').find((d:any)=>d.itemId===i.id);
 s.saveCustomer({...r.get('customer','c1'),active:false});
 assert.equal(r.get('draft',draft.id).status,'superseded');
 assert.throws(()=>s.send(draft.id),/superseded/);
 assert.equal(r.list('draft').filter((d:any)=>d.itemId===i.id&&d.status==='queued').length,0);
 s.saveCustomer({...r.get('customer','c1'),active:true});
 assert.equal(r.list('draft').filter((d:any)=>d.itemId===i.id&&d.status==='queued').length,1);
});

test('terminal and exception transitions withdraw unsent notification drafts',()=>{
 for(const transition of ['pickup','returned','exception']){
  const {s,r}=setup();
  const i=s.intake({...input,tracking:'TRANSITION-'+transition});
  const draft=r.list('draft').find((d:any)=>d.itemId===i.id);
  if(transition==='pickup')s.pickup(i.id,{check:'Photo ID checked'});
  else s.change(i.id,{state:transition,reason:'Item handling changed'});
  assert.equal(r.get('draft',draft.id).status,'superseded');
  assert.throws(()=>s.send(draft.id),/superseded/);
  assert.equal(r.list('attempt').filter((a:any)=>a.draftId===draft.id).length,0);
 }
});

test('stale or mismatched notification drafts cannot produce delivery attempts',()=>{
 const {s,r}=setup();
 const i=s.intake({...input,tracking:'STALE-RECIPIENT-1'});
 const valid=r.list('draft').find((d:any)=>d.itemId===i.id);
 r.put('draft',{...valid,id:'forged-stale-draft',customerId:'c2',status:'queued'});
 assert.throws(()=>s.send('forged-stale-draft'),/no longer eligible/);
 assert.equal(r.get('attempt','forged-stale-draft'),null);
});
