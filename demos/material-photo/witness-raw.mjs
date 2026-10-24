export async function readRawEvidence(evaluate, name, sourceExpression = 'window.__materialPhotoActions.materialEvidence()') {
  if (!['image','albedo','roughness','metallic','orm','plane-albedo','plane-orm',
    'geometry-depth','geometry-normals','geometry-points','geometry-colors'].includes(name)) throw Error('Unknown raw evidence channel');
  const source = `const {image,output,geometry}=${sourceExpression};const name=${JSON.stringify(name)};
    const value=name==='image'?image:name.startsWith('geometry-')?{width:geometry.width,height:geometry.height,data:geometry[name.slice(9)]}:
      name.startsWith('plane-')?{width:output.width,height:output.height,data:output.planes[name.slice(6)]}:output.maps[name];
    if(!value?.data)throw Error('Missing raw material evidence '+name);`;
  const raw = await evaluate(`(()=>{${source}return {width:value.width,height:value.height,type:value.data.constructor.name,byteLength:value.data.byteLength};})()`);
  const plane = name.startsWith('plane-') || name.startsWith('geometry-');
  const stride = name === 'geometry-depth' ? 4 : plane ? 12 : 4;
  if (!Number.isSafeInteger(raw?.width) || raw.width <= 0 || !Number.isSafeInteger(raw.height) || raw.height <= 0 ||
      !Number.isSafeInteger(raw.byteLength) || raw.byteLength !== raw.width * raw.height * stride ||
      !(plane ? raw.type === 'Float32Array' : ['Uint8Array','Uint8ClampedArray'].includes(raw.type))) throw Error('Invalid raw evidence layout');
  const bytes = Buffer.alloc(raw.byteLength);
  // A live Chrome/153 replay accepts 1 MiB replies but drops a 3 MiB reply.
  // This is a transport batch, not a retention limit: every source byte is copied.
  for (let offset = 0; offset < raw.byteLength; offset += 1024 * 1024) {
    const end = Math.min(raw.byteLength, offset + 1024 * 1024);
    const chunk = await evaluate(`(()=>{${source}
      const bytes=new Uint8Array(value.data.buffer,value.data.byteOffset,value.data.byteLength);
      const offset=${offset},end=${end};let binary='';
      for(let i=offset;i<end;i+=4096)binary+=String.fromCharCode(...bytes.subarray(i,Math.min(end,i+4096)));
      return {offset,byteLength:bytes.length,base64:btoa(binary)};})()`);
    const part = Buffer.from(chunk?.base64 ?? '', 'base64');
    if (chunk?.offset !== offset || chunk.byteLength !== raw.byteLength || part.length !== end - offset) throw Error('Incomplete raw evidence transfer');
    part.copy(bytes, offset);
  }
  return {...raw, bytes};
}
