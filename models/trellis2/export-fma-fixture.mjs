// Record single-rounding multiply-add cases from the native toolchain that
// builds fast_simplification (clang std::fma), keeping only cases where an
// unfused a*b+c rounds differently. Separate from the mesh fixture so mesh
// regeneration cannot drop it.
//
// node models/trellis2/export-fma-fixture.mjs --work <dir> [--out <json>]
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
if(!args.get('--work'))throw Error('--work required');
const out=args.get('--out')??path.join(here,'tests/fixtures/mesh-simplify-fma-source.json'),work=path.resolve(args.get('--work'));
await fs.mkdir(work,{recursive:true});
await fs.writeFile(path.join(work,'fma.cpp'),`#include <cmath>
#include <cstdio>
#include <random>
int main(){std::mt19937_64 g(11);std::uniform_real_distribution<double> u(-1,1);std::uniform_int_distribution<int> ex(-40,40);
 int kept=0;for(long i=0;kept<24;i++){double a=std::ldexp(u(g),ex(g)),b=std::ldexp(u(g),ex(g)),c;int k=i%3;
  if(k==0)c=std::ldexp(u(g),ex(g));else if(k==1)c=-(a*b);else c=-(a*b)*(1+std::ldexp(u(g),-30));
  volatile double p=a*b;double naive=p+c,r=std::fma(a,b,c);if(naive!=r){double row[4]={a,b,c,r};fwrite(row,8,4,stdout);kept++;}}}
`);
const compiler=execFileSync('xcrun',['clang++','--version'],{encoding:'utf8'}).split('\n')[0];
execFileSync('xcrun',['clang++','-O2','-ffp-contract=off',path.join(work,'fma.cpp'),'-o',path.join(work,'fma')]);
const raw=execFileSync(path.join(work,'fma')),values=new Float64Array(raw.buffer,raw.byteOffset,raw.length/8);
const hex=x=>Buffer.from(new Float64Array([x]).buffer).toString('hex'),cases=[];
for(let i=0;i<values.length;i+=4)cases.push([values[i],values[i+1],values[i+2],values[i+3]].map(hex));
await fs.writeFile(out,JSON.stringify({schema:'trellis2.fma-source-fixture.v0',
  source:`${compiler} std::fma, ${process.arch}; cases where unfused a*b+c rounds differently`,
  generator:'models/trellis2/export-fma-fixture.mjs',cases},null,1)+'\n');
console.log(cases.length+' cases');
