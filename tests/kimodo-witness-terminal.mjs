import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../scripts/witness-kimodo-live-flame.mjs',import.meta.url),'utf8');
const expression=code.match(/report.status=(.*);/)[1];
const status=new Function('report',`return ${expression}`);
const report={evidence:{runs:[{status:'coexistence-observed'}]},errors:[]};
assert.equal(status(report),'failed','coexistence without served identity or a completed motion export cannot pass');
console.log('Final witness requires identity and completed export');
