import {BufferGeometry, Float32BufferAttribute, DataTexture, RGBAFormat, UnsignedByteType, SRGBColorSpace, LinearFilter} from './three.core.js';
import {buildPhotoSurface} from '../demos/material-photo/photo-surface.js';
import {loadIncludedExample} from '../demos/material-photo/included-examples.js';
import {createSampleCutout} from '../demos/material-photo/sample-cutouts.js';
import {texturePixels} from '../demos/material-photo/photo-contracts.js';

const examples = {
  bag:'1024x1024:209e1a4e54d89155d3f06d395b7bdecd8dd7502be470a7577087f6a3cd9aac9d',
  orb:'1510x1514:a982f04a49b7e3c3e51cf1395863646147c3628e8e9d969fa26766ec87f667b5',
};

export async function loadLightingSurface(name) {
  if (!examples[name]) throw Error('Unknown saved material surface');
  const result = await loadIncludedExample(name,examples[name]);
  const {depth,output,provenance} = result;
  const surface = buildPhotoSurface(depth,1,createSampleCutout(name,depth.width,depth.height));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(surface.position,3));
  geometry.setAttribute('normal',new Float32BufferAttribute(surface.normal,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(surface.uv,2));
  geometry.setAttribute('color',new Float32BufferAttribute(new Float32Array(surface.normal.length),3));
  geometry.setIndex(Array.from(surface.indices));
  const pixels = texturePixels(output.maps.albedo,'albedo');
  const albedo = new DataTexture(pixels.data,pixels.width,pixels.height,RGBAFormat,UnsignedByteType);
  albedo.colorSpace = SRGBColorSpace; albedo.magFilter = albedo.minFilter = LinearFilter; albedo.needsUpdate = true;
  return {geometry,albedo,provenance:{source:provenance.source,sample:provenance.sample,revision:provenance.revision,
    inputKey:provenance.inputKey,moge:provenance.record.moge.route?.effectiveRouteId,
    supermat:provenance.record.supermat.identity,scope:'saved MoGe depth/normals and SuperMAT albedo; diffuse only; hand-authored display cutout'}};
}
