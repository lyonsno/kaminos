// kaminos-test: node
import assert from 'node:assert/strict';
import {isSurfaceAssetSource,surfaceFieldURL,surfaceAssetSources} from '../surface-asset-source.mjs';
const source='http://127.0.0.1:18714/api/read?root=generated-meshes&path=room%2Froom.surface.json';
assert(isSurfaceAssetSource(source));assert(!isSurfaceAssetSource(source.replace('generated-meshes','scratch')));assert(!isSurfaceAssetSource(source.replace('room%2F','..%2F')));
const manifest={schema:'kaminos.surface-fields-asset.v1',name:'Room',base:'factor-2/',shadowProxy:'shadow-proxy/',files:{}};
for(const p of ['factor-2/report.json','factor-2/surfels.f32','factor-2/footprints.f32','shadow-proxy/report.json','shadow-proxy/positions.f32','shadow-proxy/triangles.u32'])manifest.files[p]={sha256:'a'.repeat(64),bytes:16};
const result=surfaceAssetSources(source,manifest);assert.equal(new URL(result.base).searchParams.get('path'),'room/factor-2/');assert.equal(new URL(surfaceFieldURL(result.base,'report.json')).searchParams.get('path'),'room/factor-2/report.json');assert.equal(new URL(surfaceFieldURL(result.base,'../shadow-proxy/')).searchParams.get('path'),'room/shadow-proxy/');assert.equal(result.files.size,6);
assert.equal(surfaceFieldURL('http://localhost/scratch/room/factor-2/','report.json'),'http://localhost/scratch/room/factor-2/report.json');
for(const patch of [{base:'https://other/'},{base:'%2e%2e/other/'},{base:'../other/'},{shadowProxy:'/absolute/'},{schema:'wrong'},{name:''},{files:{}},{files:{...manifest.files,'factor-2/report.json':{sha256:'bad',bytes:16}}}])assert.throws(()=>surfaceAssetSources(source,{...manifest,...patch}));
