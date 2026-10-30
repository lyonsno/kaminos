import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildMeadowHill} from '../hill-meadow.mjs';
const {values:a}=parseArgs({options:{recipe:{type:'string'},output:{type:'string'}}});
if(!a.recipe||!a.output)throw Error('--recipe and --output are required');
const sourcePaths=['hill-meadow.mjs',a.recipe];
execFileSync('git',['ls-files','--error-unmatch',...sourcePaths],{stdio:'pipe'});
execFileSync('git',['diff','--exit-code','HEAD','--',...sourcePaths],{stdio:'pipe'});
const bytes=fs.readFileSync(a.recipe),generator=fs.readFileSync(new URL('../hill-meadow.mjs',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const terrain=buildMeadowHill(JSON.parse(bytes),{commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  recipePath:a.recipe,recipeSha256:sha(bytes),generatorSha256:sha(generator)});
fs.mkdirSync(path.dirname(a.output),{recursive:true});fs.writeFileSync(a.output,JSON.stringify(terrain)+'\n');
console.log(JSON.stringify({output:a.output,source:terrain.source,grid:terrain.grid,heightRange:[Math.min(...terrain.heights),Math.max(...terrain.heights)]}));
