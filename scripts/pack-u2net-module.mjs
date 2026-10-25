import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseArgs,promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
const exec=promisify(execFile);
export async function packU2NetModule({out,version='0.1.0'}={}) {
  if(typeof out!=='string'||!out.trim())throw Error('U2Net package output directory required');
  const destination=path.resolve(out);await fs.mkdir(destination,{recursive:true});
  const stage=await fs.mkdtemp(path.join(os.tmpdir(),'u2net-pack-'));
  try {
    await build({entryPoints:[new URL('../models/u2net/index.js',import.meta.url).pathname],outfile:path.join(stage,'u2net-inference.js'),bundle:true,format:'esm',platform:'browser',target:'esnext'});
    await fs.copyFile(new URL('../models/u2net/README.md',import.meta.url),path.join(stage,'README.md'));
    await fs.copyFile(new URL('../webgpu-inference-kit/LICENSE',import.meta.url),path.join(stage,'LICENSE'));
    await fs.copyFile(new URL('../webgpu-inference-kit/THIRD_PARTY_NOTICES.txt',import.meta.url),path.join(stage,'THIRD_PARTY_NOTICES.txt'));
    const manifest={name:'@kaminos/u2net',version,private:false,publishConfig:{access:'public'},type:'module',license:'MIT',
      description:'U2Net background removal on a shared WebGPU device.',main:'./u2net-inference.js',
      exports:{'.':'./u2net-inference.js','./package.json':'./package.json'},
      files:['u2net-inference.js','README.md','LICENSE','THIRD_PARTY_NOTICES.txt'],
      repository:{type:'git',url:'git+https://github.com/lyonsno/kaminos.git',directory:'models/u2net'}};
    await fs.writeFile(path.join(stage,'package.json'),JSON.stringify(manifest,null,2)+'\n');
    const {stdout}=await exec('npm',['pack','--json','--ignore-scripts','--pack-destination',destination],{cwd:stage});
    const [packed]=JSON.parse(stdout);return {...packed,tarball:path.join(destination,packed.filename)};
  } finally {await fs.rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const {values}=parseArgs({options:{out:{type:'string'},version:{type:'string'}}});
  console.log(JSON.stringify(await packU2NetModule(values)));
}
