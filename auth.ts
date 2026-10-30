import {randomBytes, createHash, scryptSync, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {StaffActor, StaffRole} from './actor.ts';

export class AccessError extends Error {
  constructor(message:string, public status:number){super(message)}
}
type Account = StaffActor & {login:string;salt:Buffer;hash:Buffer};
type Session = {actor:StaffActor;csrf:string;expires:number};
const HOURS_8 = 8*60*60*1000;
const actionRoles:Record<string,StaffRole[]> = {
  match:['clerk','manager'], intake:['clerk','manager'], pickup:['clerk','manager'],
  upload:['clerk','manager'], send:['clerk','manager'],
  change:['manager'], customer:['manager'], authorization:['manager'],
  purge:['manager'], retention:['manager'], reset:['manager'], logout:['clerk','manager','auditor']
};
function digest(text:string){return createHash('sha256').update(text).digest('hex')}
function cookie(req:IncomingMessage):string|null {
  const cookies=(req.headers.cookie||'').split(';').map(x=>x.trim());
  const found=cookies.find(x=>x.startsWith('mm_session='));
  return found?.slice('mm_session='.length)||null;
}
export function createDemoAuth(){
  const sources:{login:string;id:string;name:string;role:StaffRole;env:string}[]=[
    {login:'alex',id:'staff-alex',name:'Alex Rivera',role:'clerk',env:'MAPLE_CLERK_PASSWORD'},
    {login:'morgan',id:'staff-morgan',name:'Morgan Lee',role:'manager',env:'MAPLE_MANAGER_PASSWORD'},
    {login:'casey',id:'staff-casey',name:'Casey Chen',role:'auditor',env:'MAPLE_AUDITOR_PASSWORD'}
  ];
  const accounts=new Map<string,Account>();
  for(const a of sources){
    const configured=process.env[a.env];
    const generated=!configured;
    const password=configured||randomBytes(18).toString('base64url');
    const salt=randomBytes(16),hash=scryptSync(password,salt,64);
    accounts.set(a.login,{id:a.id,name:a.name,login:a.login,role:a.role,salt,hash});
    console.log(`[Local demo login] ${a.login} (${a.role}): ${generated?password:'password supplied via '+a.env}`);
  }
  console.log('[Local demo] Credentials are for synthetic loopback use ONLY. Never expose this server publicly.');
  const dummySalt=randomBytes(16),dummyHash=scryptSync(randomBytes(24),dummySalt,64);
  const sessions=new Map<string,Session>();
  const failures=new Map<string,{count:number;until:number}>();
  function signIn(loginInput:unknown,passwordInput:unknown){
    const login=typeof loginInput==='string'?loginInput.toLowerCase().trim():'';
    const password=typeof passwordInput==='string'?passwordInput:'';
    const attempt=failures.get(login);
    if(attempt && attempt.count>=8 && Date.now()<attempt.until)throw new AccessError('Too many attempts; retry later',429);
    const account=accounts.get(login);
    const candidate=scryptSync(password,account?.salt||dummySalt,64);
    if(!account || !timingSafeEqual(candidate,account.hash)){
      const old=failures.get(login);
      failures.set(login,{count:(old?.until && old.until>Date.now()?old.count:0)+1,until:Date.now()+60_000});
      throw new AccessError('Invalid sign-in',401);
    }
    failures.delete(login);
    const actor:StaffActor={id:account.id,name:account.name,role:account.role};
    const token=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
    const expires=Date.now()+HOURS_8;
    sessions.set(digest(token),{actor,csrf,expires});
    return {actor,csrf,token,expires};
  }
  function session(req:IncomingMessage):Session{
    const token=cookie(req);
    const item=token && sessions.get(digest(token));
    if(!item || item.expires<=Date.now()){
      if(token)sessions.delete(digest(token));
      throw new AccessError('Sign in to access the demo workspace',401);
    }
    return item;
  }
  function requireAccess(req:IncomingMessage,action:string){
    const active=session(req);
    if(req.method==='POST'){
      const supplied=req.headers['x-csrf-token'];
      if(typeof supplied!=='string' || supplied!==active.csrf)throw new AccessError('Invalid session request token',403);
      const allowed=actionRoles[action];
      if(!allowed || !allowed.includes(active.actor.role))throw new AccessError('Staff role does not permit this action',403);
    }
    if(req.method==='GET' && action==='export' && !['manager','auditor'].includes(active.actor.role)){
      throw new AccessError('Staff role does not permit exporting records',403);
    }
    return active;
  }
  function signOut(req:IncomingMessage){
    const token=cookie(req);
    if(token)sessions.delete(digest(token));
  }
  return {signIn,session,requireAccess,signOut};
}
export function sessionCookie(token:string){
  return `mm_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`;
}
export const clearSessionCookie='mm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
