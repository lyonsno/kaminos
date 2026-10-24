// Convert existing Radiance assets through Three's maintained readers/writers.
import {readFile, writeFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {DataTexture, FloatType, RGBAFormat} from 'three';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {EXRExporter} from 'three/addons/exporters/EXRExporter.js';

const {values} = parseArgs({options:{input:{type:'string'},output:{type:'string'}}});
if (!values.input || !values.output) throw Error('--input and --output are required');
const bytes = await readFile(values.input);
const {data,width,height} = new RGBELoader().setDataType(FloatType).parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
// EXRExporter accepts bottom-up texture rows; RGBELoader returns top-down rows.
const flipped = new Float32Array(data.length), stride = width*4;
for (let y=0; y<height; y++) flipped.set(data.subarray(y*stride,(y+1)*stride),(height-1-y)*stride);
const texture = new DataTexture(flipped,width,height,RGBAFormat,FloatType);
await writeFile(values.output,await new EXRExporter().parse(texture,{type:FloatType,compression:0}));
texture.dispose();
