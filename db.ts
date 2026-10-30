import { DatabaseSync } from 'node:sqlite';
import {currentActor} from './actor.ts';
export const org='maple-demo';
export function database(path:string){
 const db=new DatabaseSync(path); db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS records(org TEXT NOT NULL, kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(org,kind,id));
 CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,org TEXT NOT NULL,item TEXT,kind TEXT NOT NULL,at TEXT NOT NULL,staff TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS immutable_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'History is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS immutable_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'History is immutable'); END;`);return db;
}
export function repository(db:any){
 const list=(kind:string)=>db.prepare('SELECT data FROM records WHERE org=? AND kind=?').all(org,kind).map((r:any)=>JSON.parse(r.data));
 const get=(kind:string,id:string)=>{if(!id)return null;const r:any=db.prepare('SELECT data FROM records WHERE org=? AND kind=? AND id=?').get(org,kind,id);return r?JSON.parse(r.data):null};
 const put=(kind:string,r:any)=>{db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(org,kind,id) DO UPDATE SET data=excluded.data').run(org,kind,r.id,JSON.stringify(r));return r};
 const event=(item:string,kind:string,data:any)=>db.prepare('INSERT INTO events(org,item,kind,at,staff,data) VALUES(?,?,?,?,?,?)').run(org,item,kind,new Date().toISOString(),`${currentActor().name} (${currentActor().id})`,JSON.stringify(data));
 const transaction=(fn:Function)=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}};
 return {list,get,put,event,transaction,history:(id:string)=>db.prepare('SELECT * FROM events WHERE org=? AND item=? ORDER BY seq').all(org,id)};
}
