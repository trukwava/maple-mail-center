import {AsyncLocalStorage} from 'node:async_hooks';

export type StaffRole = 'clerk'|'manager'|'auditor';
export type StaffActor = {id:string;name:string;role:StaffRole};
export const staffContext = new AsyncLocalStorage<StaffActor>();
const demoSeeder:StaffActor = {id:'demo-seed',name:'Demo Seeder',role:'manager'};

export function currentActor(): StaffActor {
  return staffContext.getStore() ?? demoSeeder;
}
