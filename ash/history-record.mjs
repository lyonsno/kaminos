import {ASH_OBJECT_TYPE} from './scene-record.mjs';
// Membership Undo retains this exact GPU root. Saved scenes still serialize
// checkpoints through the normal record route, outside membership history.
export function ashMembershipEntry(entry){
 return entry.type===ASH_OBJECT_TYPE?{...entry,ash:{...entry.ash,checkpoint:null}}:entry;
}
