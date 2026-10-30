import {randomUUID} from 'node:crypto';
export const normalize=(s:any)=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function service(r:any){
 const fail=(s:string)=>{throw Error(s)};
 const required=(v:any,s:string)=>String(v||'').trim()||fail(s+' is required');
 const draft=(item:any)=>{const c=r.get('customer',item.customerId);return r.put('draft',{id:randomUUID(),itemId:item.id,customerId:c.id,status:'queued',language:c.language,text:c.language==='es'?`Hola ${c.name}, su ${item.type} ${item.tracking} está listo para recoger en Maple Mail Center.`:`Hello ${c.name}, your ${item.type} ${item.tracking} is ready for pickup at Maple Mail Center.`,createdAt:new Date().toISOString()})};
 const candidates=(p:any)=>r.list('customer').map((c:any)=>{const evidence=[];if(p.mailbox&&normalize(p.mailbox)===normalize(c.mailbox))evidence.push('Mailbox matches');if(p.name&&normalize(p.name)===normalize(c.name))evidence.push('Name matches');if(p.name&&c.aliases.some((a:string)=>normalize(a)===normalize(p.name)))evidence.push('Approved alias matches');if(p.tracking&&r.list('item').some((i:any)=>normalize(i.tracking)===normalize(p.tracking)&&i.customerId===c.id))evidence.push('Previous tracking reference');return {...c,evidence}}).filter((c:any)=>c.evidence.length).sort((a:any,b:any)=>b.evidence.length-a.evidence.length);
 const supersedeDrafts=(itemId:string)=>{let count=0;for(const d of r.list('draft').filter((d:any)=>d.itemId===itemId&&['queued','failed','unknown'].includes(d.status))){d.status='superseded';r.put('draft',d);count++}return count};
 const saveCustomer=(p:any)=>r.transaction(()=>{
  const name=required(p.name,'Name').trim(),mailbox=required(p.mailbox,'Mailbox').trim();
  if(!['en','es'].includes(p.language))fail('Choose English or Spanish');
  if(typeof p.active!=='boolean')fail('Explicit customer active status required');
  const prior=p.id?r.get('customer',p.id):null;
  if(p.id&&!prior)fail('Customer not found');
  if(r.list('customer').some((c:any)=>c.id!==p.id&&normalize(c.mailbox)===normalize(mailbox)))fail('Mailbox already assigned to another customer');
  const values=Array.isArray(p.aliases)?p.aliases:String(p.aliases||'').split(',');
  const aliases=[...new Set(values.map((x:any)=>String(x).trim()).filter(Boolean))];
  const customer=r.put('customer',{id:prior?.id||randomUUID(),name,mailbox,language:p.language,contact:String(p.contact||'').trim(),aliases,active:p.active});
  const changed=prior?['name','mailbox','language','contact','aliases','active'].filter(k=>JSON.stringify(prior[k])!==JSON.stringify(customer[k])):['created'];
  r.event('',prior?'customer updated':'customer created',{customerId:customer.id,changed});
  if(prior&&changed.some(k=>['name','language','contact','active'].includes(k))){
   for(const item of r.list('item').filter((i:any)=>i.customerId===customer.id&&i.state==='available')){
    const withdrawn=supersedeDrafts(item.id);
    if(customer.active&&(withdrawn>0||prior.active===false)){draft(item);r.event(item.id,'notification draft refreshed',{reason:'Customer details changed',customerId:customer.id})}
    else if(withdrawn)r.event(item.id,'notification drafts withdrawn',{reason:'Customer inactive',customerId:customer.id,count:withdrawn});
   }
  }
  return customer;
 });
 const intake=(p:any)=>r.transaction(()=>{
 required(p.tracking,'Tracking');required(p.location,'Location');if(!r.get('location',p.location))fail('Choose a valid storage location');
 if(!['package','letter','certified mail'].includes(p.type))fail('Choose an item type');
 const duplicates=r.list('item').filter((i:any)=>normalize(i.tracking)===normalize(p.tracking));if(duplicates.length&&!p.duplicateReason?.trim())fail('Duplicate tracking: open existing item or record a reuse reason');
 let customer=null;if(!p.review){customer=r.get('customer',p.customerId);if(!customer?.active)fail('Choose an active customer');if(p.confirmed!==true)fail('Explicit recipient confirmation is required');required(p.evidence,'Recipient verification evidence');}
 const item=r.put('item',{id:randomUUID(),tracking:p.tracking.trim(),carrier:required(p.carrier,'Carrier'),type:p.type,location:p.location,condition:String(p.condition||''),customerId:customer?.id||null,state:p.review?'exception':'available',arrivedAt:new Date().toISOString(),labelId:p.labelId||null,source:{name:p.name||'',mailbox:p.mailbox||''},duplicateReason:p.duplicateReason||null});
 r.event(item.id,'received',{source:item.source,duplicateReason:item.duplicateReason});r.put('match',{id:randomUUID(),itemId:item.id,candidates:candidates(p)});
 if(customer){r.put('confirmation',{id:randomUUID(),itemId:item.id,customerId:customer.id,evidence:p.evidence,staff:'Alex Rivera',at:new Date().toISOString()});r.event(item.id,'recipient confirmed',{customerId:customer.id,evidence:p.evidence});draft(item)}else r.event(item.id,'exception',{reason:'Recipient needs review'});return item;
 });
 const change=(id:string,p:any)=>r.transaction(()=>{const i=r.get('item',id)||fail('Item not found');required(p.reason,'Reason');if(['collected','returned'].includes(i.state))fail('Terminal item cannot change');const before={...i};
 if(p.customerId){const c=r.get('customer',p.customerId);if(!c?.active||p.confirmed!==true)fail('Active recipient and explicit confirmation required');i.customerId=c.id;supersedeDrafts(id);r.put('confirmation',{id:randomUUID(),itemId:id,customerId:c.id,evidence:p.reason,staff:'Alex Rivera'});i.state='available';draft(i)}
 if(p.location){if(!r.get('location',p.location))fail('Unknown location');i.location=p.location}
 if(p.state){const valid:any={received:['available','exception','returned'],available:['collected','returned','exception'],exception:['available','returned']};if(!valid[i.state]?.includes(p.state)||p.state==='collected')fail('Invalid transition; use pickup workflow');if(p.state==='available'&&!i.customerId)fail('Confirm a recipient first');i.state=p.state}
 if(i.state!=='available'){const withdrawn=supersedeDrafts(id);if(withdrawn)r.event(id,'notification drafts withdrawn',{reason:p.reason,count:withdrawn})}
 r.put('item',i);r.event(id,'correction',{before,after:i,reason:p.reason});return i});
 const pickup=(id:string,p:any)=>r.transaction(()=>{const i=r.get('item',id)||fail('Item not found');if(i.state!=='available')fail('Item is no longer available');required(p.check,'Staff identity check');if(p.check!=='Photo ID checked')fail('Configured check requires Photo ID checked');
 if(p.thirdParty){const a=r.get('authorization',p.authorizationId);if(!a||a.customerId!==i.customerId||a.revoked||a.expiresAt<new Date().toISOString())fail('Valid separate pickup authorization required');}
 i.state='collected';i.collectedAt=new Date().toISOString();r.put('item',i);r.event(id,'collected',{check:p.check,authorizationId:p.thirdParty?p.authorizationId:null});return i});
 const send=(id:string)=>r.transaction(()=>{const d=r.get('draft',id)||fail('Draft not found');if(d.status==='superseded')fail('Draft superseded');const old=r.get('attempt',id);if(old)return old;const c=r.get('customer',d.customerId),item=r.get('item',d.itemId);if(!c?.active||!item||item.state!=='available'||item.customerId!==c.id)fail('Draft no longer eligible: review customer and custody state');if(d.status!=='queued')fail('Draft must be queued before an attempt');const status=c.id==='c7'?'failed':'simulated';const a=r.put('attempt',{id, idempotencyKey:`maple-demo:${id}`,draftId:id,status,at:new Date().toISOString(),detail:status==='failed'?'Deterministic demo adapter failure':'Demo simulation only; no external message sent'});d.status=status;r.put('draft',d);r.event(d.itemId,'notification attempt',a);return a});
 return {candidates,intake,change,pickup,send,draft,saveCustomer};
}
