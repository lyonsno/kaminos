#!/usr/bin/env node
// node tools/piston-arm-scene.mjs --template scene.json --out new.json [--parameters params.json]
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pistonArmScene} from '../piston-arm-kit.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2){if(!['--template','--out','--parameters'].includes(process.argv[i])||!process.argv[i+1])throw Error('Use --template FILE --out FILE [--parameters FILE]');args.set(process.argv[i],process.argv[i+1]);}
if(!args.get('--template')||!args.get('--out'))throw Error('Use --template FILE --out FILE [--parameters FILE]');
const target=resolve(args.get('--out'));if(existsSync(target))throw Error(`Output already exists: ${target}; choose a new path`);
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const scene=pistonArmScene(read(args.get('--template')),args.has('--parameters')?read(args.get('--parameters')):{});
writeFileSync(target,JSON.stringify(scene,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({path:target,objects:scene.objects.length,carrier:scene.provenance.analyticalCarrier,actuator:scene.actuators[0].id}));
