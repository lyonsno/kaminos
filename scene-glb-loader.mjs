import {isSurfaceSplatResolve} from './surface-splat-object.mjs';
// The ordinary GLB preparation/publication path shared by page and scene worker.
// GPU/material/geometry and membership services stay with the local scene owner;
// UI installation and status are callbacks, never DOM reads in this loader.
export function createSceneGlbLoader({GLTFLoader,workingScene,readScene,readAssetBytes,sceneLightingPreparation,
 shouldClearSceneForImport,clearScene,resolveAssetArrivalMode,loadingTelemetry,sourceChanged=()=>{},
 origin=()=>globalThis.location?.origin??'http://127.0.0.1',mountSingleAssetLowLodStandIn,greenroomPreviewIsActive=()=>false,
 prepareGLBGeometryArrival,disposeObjectTree,readPreviewGeneration=()=>undefined,readEnvironmentIntensity=()=>1,
 readMaxAnisotropy=()=>16,prepareArrivedMeshMaterials,applyAssetArrival,readArrivalLighting=()=>null,
 previewLoaded=()=>{},registerSceneObject,onActivate=()=>{},frameAssetArrival,syncArrivalLightingAndGI,setInfo=()=>{}}){
 return async function showGLB(file, options = {}) {
  let loadToken = workingScene.generation;
  const isBlob = typeof file !== 'string';
  const url = isBlob ? file.name : file;
  const assetMetadata = {...(options.metadata || {})};
  const assetSource = assetMetadata.source ?? (isBlob ? file.name : file);
  let resolvedUrlName = isBlob ? (file?.name || 'object.glb') : String(file);
  if (!isBlob && resolvedUrlName.includes('path=')) {
    try {
      const pathParam = new URL(resolvedUrlName, origin()).searchParams.get('path');
      if (pathParam) resolvedUrlName = pathParam;
    } catch {}
  }
  const assetFileName = assetMetadata.fileName ?? file?.name ?? (isBlob ? 'object.glb' : resolvedUrlName.split('/').pop());
  const telemetryLabel = assetMetadata.label || assetFileName;
  sourceChanged({file,source:isBlob?file.name:file,type:'glb'});
  const telemetryOp = options.telemetryOp || (typeof loadingTelemetry !== 'undefined'
    ? loadingTelemetry.start('asset', { label: telemetryLabel, phase: 'reading-file' })
    : null);
  const readAbort = new AbortController();
  const inputBytes = options.preparedAsset ? null : (options.inputBytes
    ? Promise.resolve(options.inputBytes)
    : readAssetBytes(file,{signal:readAbort.signal,progress:bytes=>{
        if(loadToken===workingScene.generation&&options.isCurrent?.()!==false)loadingTelemetry?.progress('asset',{label:telemetryLabel,phase:'downloading',token:telemetryOp?.token,...bytes});
      }}));
  // Observe read failures immediately even if renderer preparation is still pending.
  inputBytes?.catch(()=>{});
  let cleared=false;
  try {
    await sceneLightingPreparation?.whenIdle();
    if(loadToken!==workingScene.generation||options.isCurrent?.()===false)throw Error('stale async GLB load ignored');
    cleared = shouldClearSceneForImport(options);
    if(cleared&&!await clearScene()){readAbort.abort();loadingTelemetry?.cancel?.('asset',{token:telemetryOp?.token});return null;}
    loadToken=workingScene.generation;
  } catch(error) {
    readAbort.abort();
    if(loadToken!==workingScene.generation||options.isCurrent?.()===false)loadingTelemetry?.cancel?.('asset',{token:telemetryOp?.token});
    else loadingTelemetry?.fail('asset',error,{token:telemetryOp?.token});
    throw error;
  }
  const arrival = resolveAssetArrivalMode({arrival:options.arrival,normalize:options.normalize,cleared});
  const loader = new GLTFLoader();
  let heroSettled = false;
  const releaseEarlyStandIn = typeof mountSingleAssetLowLodStandIn === 'function'
    ? mountSingleAssetLowLodStandIn({
        url,
        isBlob,
        arrival,
        assetMetadata,
        isCurrent: () => !heroSettled && loadToken === workingScene.generation && options.isCurrent?.() !== false && !(greenroomPreviewIsActive() && options.register !== false),
      })
    : null;
	return new Promise((resolve, reject) => {
    const onLoad=async gltf=>{
      let preparedGeometry=null;
      if(typeof prepareGLBGeometryArrival==='function'){
        loadingTelemetry?.progress('asset',{label:telemetryLabel,phase:'preparing-geometry',token:telemetryOp?.token});
        try{preparedGeometry=await prepareGLBGeometryArrival(gltf.scene,arrival,()=>loadToken===workingScene.generation&&options.isCurrent?.()!==false,{activate:options.activate!==false});}
        catch(error){disposeObjectTree(gltf.scene);throw error;}
      }
      heroSettled = true;
      const earlyStandIn = releaseEarlyStandIn?.() ?? null;

      if (typeof loadingTelemetry !== 'undefined') {
        loadingTelemetry.progress('asset', { label: telemetryLabel, phase: 'preparing-materials',token:telemetryOp?.token });
      }
	    sourceChanged({scene:gltf.scene});
	    const model = gltf.scene;
      const stalePreviewLoad = options.register === false
        && options.previewGeneration !== undefined
        && readPreviewGeneration() !== options.previewGeneration;
      if (loadToken !== workingScene.generation || stalePreviewLoad || options.isCurrent?.()===false || (greenroomPreviewIsActive() && options.register !== false)) {
        if (typeof loadingTelemetry !== 'undefined') loadingTelemetry.cancel?.('asset', { token: telemetryOp?.token });
        disposeObjectTree(model);
        reject(new Error('stale async GLB load ignored'));
        return;
      }
      const envIntensity = readEnvironmentIntensity();
      const maxAniso = readMaxAnisotropy();
      if (typeof prepareArrivedMeshMaterials === 'function') {
        prepareArrivedMeshMaterials(model, {
          maxAnisotropy: maxAniso,
          materialTuning: false,
          baseEnvMapIntensity: envIntensity,
        });
      }
      const arrivalPlacement = applyAssetArrival(model, arrival, preparedGeometry);
      model.traverse(child => {
        if (child.isMesh) {
          child.castShadow = !isSurfaceSplatResolve(child);
          child.receiveShadow = true;
          if (child.material && typeof prepareArrivedMeshMaterials !== 'function') {
            for (const mat of [].concat(child.material)) {
              if (mat) mat.envMapIntensity = envIntensity;
            }
          }
        }
      });
      if (typeof prepareArrivedMeshMaterials === 'function') {
        prepareArrivedMeshMaterials(model, {
          maxAnisotropy: maxAniso,
          materialTuning: readArrivalLighting()?.materialTuningEnabled??false,
          materialProfile: readArrivalLighting()?.materialProfile??null,
          baseEnvMapIntensity: envIntensity,
        });
      }
      readScene().add(model);
      let registeredAsset = null;
      if (options.register === false) {
        const metadata = assetMetadata;
        model.userData.kaminosSceneObject = {
          source: assetSource,
          type: metadata.type ?? 'glb',
          fileName: assetFileName,
          label: metadata.label ?? assetFileName,
        };
        previewLoaded(model);
      } else {
        registeredAsset = registerSceneObject(model, {
          ...assetMetadata,
          source: assetSource,
          type: assetMetadata.type ?? 'glb',
          fileName: assetFileName,
        }, {activate:options.activate!==false});
      }
      if(options.activate!==false)onActivate(model);
      if (arrival === 'fresh' && arrivalPlacement) {
        if (earlyStandIn?.framed && earlyStandIn.cameraMovedSinceFrame && typeof syncArrivalLightingAndGI === 'function') {
          syncArrivalLightingAndGI(model,preparedGeometry?.bounds);
        } else {
          frameAssetArrival(model, preparedGeometry);
        }
      }
      if (typeof loadingTelemetry !== 'undefined') loadingTelemetry.complete('asset',{token:telemetryOp?.token});
      setInfo('GLB Inspector — orbit to inspect | use toolbar to fix orientation');
      resolve(options.returnAsset ? {
        id: registeredAsset?.id ?? null,
        root: model,
        clips: gltf.animations || [],
        source: assetSource,
        fileName: assetFileName,
        arrival,
      } : model);
    };
    const onError=err=>{
      heroSettled = true;
      releaseEarlyStandIn?.();

      if (typeof loadingTelemetry !== 'undefined') loadingTelemetry.fail('asset', err,{token:telemetryOp?.token});
      setInfo('Failed to load GLB: ' + (err.message || 'unknown error'));
      reject(err);
    };
    if(options.preparedAsset)Promise.resolve(options.preparedAsset).then(onLoad).catch(onError);
    else inputBytes.then(bytes=>{
      if(loadToken!==workingScene.generation||options.isCurrent?.()===false)throw Error('stale async GLB load ignored');
      loadingTelemetry?.progress('asset',{label:telemetryLabel,phase:'decoding',token:telemetryOp?.token});
      return loader.parseAsync(bytes,isBlob?'':url.slice(0,url.lastIndexOf('/')+1));
    }).then(onLoad).catch(onError);
  });
};
}
