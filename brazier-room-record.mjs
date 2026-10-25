// Compatibility for the original generated corridor's saved experiment records.
// Other experiment roots have no implied reconstruction contract.
export function isBrazierRoomRecord(record){
 if(record?.type!=='experiment'||typeof record.source!=='string')return false;
 try{const u=new URL(record.source,'http://localhost/');return ['http:','https:'].includes(u.protocol)&&u.pathname==='/scratch/brazier-corridor-1024/factor-2/';}catch{return false;}
}
