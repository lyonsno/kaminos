// kaminos-test: node
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['tools/mls-juice-witness.mjs','--self-test'],{stdio:'inherit'});
