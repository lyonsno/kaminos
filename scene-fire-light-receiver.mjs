// Actual ordinary fire irradiance receiving, including shadows and world probes.
// All resources and live producer reads belong to the caller's GPU owner.
export function createSceneFireLightReceiver({THREE,sharedGpu,renderer,scene,camera,sceneGiProxies,routeParams,readLightField,
  createFireLightFieldShadow,createFireShadowCasters,renderFireShadowBatch},baseOutputNode,sceneDepthNode,sceneNormalNode){
  const TSL=THREE.TSL;
  const {uniform,texture,vec2,vec3,vec4,viewportUV,getViewPosition,floor,float,mod,mix,step,Fn}=TSL;
  const FIRE_LIGHT_FIELD_PASS_IDENTITY = 'world-position-fire-light-field-receiver-pass-v0';
  const FIRE_LIGHT_FIELD_ATLAS_IDENTITY = 'gpu-fire-irradiance-lattice-atlas-v0';
  const FIRE_LIGHT_FIELD_MASK_AUTHORITY = 'scene-prepass-depth-world-position-normal-material-v0';
  const blackAtlasTexture = sharedGpu.device.createTexture({
    label: 'kaminos fire light field black atlas placeholder',
    size: { width: 1, height: 1, depthOrArrayLayers: 1 },
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const atlasExternalTexture = new THREE.ExternalTexture(blackAtlasTexture);
  atlasExternalTexture.image = { width: 1, height: 1, depth: 1 };
  atlasExternalTexture.format = THREE.RGBAFormat;
  atlasExternalTexture.type = THREE.HalfFloatType;
  atlasExternalTexture.colorSpace = THREE.NoColorSpace;
  atlasExternalTexture.minFilter = THREE.LinearFilter;
  atlasExternalTexture.magFilter = THREE.LinearFilter;
  atlasExternalTexture.generateMipmaps = false;

  const routeStrength = parseFloat(routeParams.get('volume_light_field_strength') ?? '');
  const baseStrength = Number.isFinite(routeStrength) ? Math.max(0, routeStrength) : 1.0;
  const routeFarStrength = parseFloat(routeParams.get('volume_light_field_far') ?? '');
  const baseFarStrength = Number.isFinite(routeFarStrength) ? Math.max(0, routeFarStrength) : 1.0;
  const debugView = routeParams.get('volume_light_field_debug') || '';
  const fireLightFieldStrength = uniform(0.0);
  const farFieldStrength = uniform(baseFarStrength);
  const blackMetaTexture = sharedGpu.device.createTexture({
    label: 'kaminos fire light field black meta placeholder',
    size: { width: 4, height: 1, depthOrArrayLayers: 1 },
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  const metaExternalTexture = new THREE.ExternalTexture(blackMetaTexture);
  metaExternalTexture.image = { width: 4, height: 1, depth: 1 };
  metaExternalTexture.format = THREE.RGBAFormat;
  metaExternalTexture.type = THREE.HalfFloatType;
  metaExternalTexture.colorSpace = THREE.NoColorSpace;
  metaExternalTexture.minFilter = THREE.NearestFilter;
  metaExternalTexture.magFilter = THREE.NearestFilter;
  metaExternalTexture.generateMipmaps = false;
  const metaTextureNode = texture(metaExternalTexture);
  const isolateMix = uniform((routeParams.get('volume_light_field_isolate')==='1') ? 1.0 : 0.0);
  const atlasGrid = uniform(32.0);
  const atlasGridY = uniform(64.0);
  const fieldWorldMin = uniform(new THREE.Vector3(-1, -1, -1));
  const fieldWorldMax = uniform(new THREE.Vector3(1, 3, 1));
  const fieldCellPitch = uniform(2.0 / 32.0);
  const atlasTilesX = uniform(8.0);
  const atlasTexelSize = uniform(new THREE.Vector2(1 / 256, 1 / 128));

  const atlasTextureNode = texture(atlasExternalTexture);
  const depthSampleNode = sceneDepthNode.sample(viewportUV).r;
  // The output pass renders with a fullscreen quad camera, so the TSL
  // cameraProjectionMatrixInverse/cameraWorldMatrix nodes would resolve to the
  // quad's ortho camera. Bind the scene camera's matrices explicitly and
  // refresh them every frame in update(), the same way GTAO does.
  const sceneProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const sceneCameraWorldMatrix = uniform(new THREE.Matrix4());
  const viewPositionNode = getViewPosition(viewportUV, depthSampleNode, sceneProjectionMatrixInverse);
  const worldPositionNode = sceneCameraWorldMatrix.mul(vec4(viewPositionNode, 1.0)).xyz;

  // Trilinear sample of the rectangular equal-pitch lattice through its 2D tile atlas.
  const sampleLatticeAt = (positionNode) => {
    const uvw = positionNode.sub(fieldWorldMin).div(fieldWorldMax.sub(fieldWorldMin)).clamp(vec3(0.0), vec3(1.0));
    const sliceCoord = uvw.z.mul(atlasGrid).sub(0.5);
    const slice0 = floor(sliceCoord).clamp(float(0.0), atlasGrid.sub(1.0));
    const slice1 = slice0.add(1.0).clamp(float(0.0), atlasGrid.sub(1.0));
    const sliceMix = sliceCoord.sub(slice0).clamp(0.0, 1.0);
    const inTileTexel = vec2(uvw.x.mul(atlasGrid), uvw.y.mul(atlasGridY)).clamp(vec2(0.5), vec2(atlasGrid, atlasGridY).sub(0.5));
    const atlasUvForSlice = (sliceIndex) => {
      const tileX = mod(sliceIndex, atlasTilesX);
      const tileY = floor(sliceIndex.div(atlasTilesX));
      return vec2(
        tileX.mul(atlasGrid).add(inTileTexel.x),
        tileY.mul(atlasGridY).add(inTileTexel.y)
      ).mul(atlasTexelSize);
    };
    return mix(
      atlasTextureNode.sample(atlasUvForSlice(slice0)),
      atlasTextureNode.sample(atlasUvForSlice(slice1)),
      sliceMix
    );
  };
  const latticeUvw = worldPositionNode.sub(fieldWorldMin).div(fieldWorldMax.sub(fieldWorldMin)).clamp(vec3(0.0), vec3(1.0));
  const latticeSample = sampleLatticeAt(worldPositionNode);

  // Directional shading: the irradiance field's luminance gradient points
  // toward the fire, so central differences over one lattice cell recover the
  // incident light direction at every receiver pixel. Shading with true
  // N.L against this direction replaces the earlier camera-facing stand-in,
  // which lit surfaces by screen orientation instead of the fire-to-surface
  // vector (operator-reported as proximity glow with no above/below response).
  const lumaWeights = vec3(0.2126, 0.7152, 0.0722);
  const gradientEps = fieldCellPitch;
  const lumaAt = (positionNode) => sampleLatticeAt(positionNode).rgb.dot(lumaWeights);
  // Analytic far field: the diffusion lattice only carries light ~4 cells
  // from the flame body, which reads as a flashlight pointing straight up.
  // The producer reduces the live field to centroid/power/color each frame
  // (fire-irradiance-far-field-meta-v0); receivers add a true 1/r^2 radial
  // term from that center, N.L shaded and NOT clipped to the lattice box,
  // so side walls and out-of-box geometry receive real fire light.
  const metaCore = metaTextureNode.sample(vec2(0.125, 0.5));
  const metaColor = metaTextureNode.sample(vec2(0.375, 0.5));
  const emissionCenter = metaTextureNode.sample(vec2(0.625, 0.5));
  const emissionVariance = metaTextureNode.sample(vec2(0.875, 0.5));
  const emissionWorldCenter = fieldWorldMin.add(emissionCenter.xyz.mul(fieldWorldMax.sub(fieldWorldMin)));
  const emissionWorldRadius = emissionVariance.xyz.mul(fieldWorldMax.sub(fieldWorldMin).pow(2)).dot(vec3(1)).max(0).sqrt().mul(2).mul(emissionCenter.w);
  const fireCenterWorld = fieldWorldMin.add(metaCore.xyz.mul(fieldWorldMax.sub(fieldWorldMin)));
  const firePower = metaCore.w;
  // Fire light arriving at a world point with a surface normal, before shadow
  // and any screen-only masking. Shared by the receiver pixels and by
  // world-point probes, so both see exactly the same light.
  const fireLightAt = (positionNode, normalNode) => {
    // Directional shading: the irradiance field's luminance gradient points
    // toward the fire, so central differences over one lattice cell recover the
    // incident light direction at every receiver. Shading with true N.L against
    // this direction replaces the earlier camera-facing stand-in, which lit
    // surfaces by screen orientation instead of the fire-to-surface vector
    // (operator-reported as proximity glow with no above/below response).
    const latticeGradient = vec3(
      lumaAt(positionNode.add(vec3(gradientEps, 0.0, 0.0))).sub(lumaAt(positionNode.sub(vec3(gradientEps, 0.0, 0.0)))),
      lumaAt(positionNode.add(vec3(0.0, gradientEps, 0.0))).sub(lumaAt(positionNode.sub(vec3(0.0, gradientEps, 0.0)))),
      lumaAt(positionNode.add(vec3(0.0, 0.0, gradientEps))).sub(lumaAt(positionNode.sub(vec3(0.0, 0.0, gradientEps))))
    );
    const gradientLength = latticeGradient.length();
    const lightDirection = latticeGradient.div(gradientLength.max(1e-6));
    // Outside the lattice box, attenuate continuously with exterior distance so
    // nearby receivers keep light while the far scene falls off.
    const exteriorNode = fieldWorldMin.sub(positionNode).max(positionNode.sub(fieldWorldMax)).max(vec3(0.0));
    const exteriorDistance = exteriorNode.length();
    const exteriorFalloff = float(1.0).div(
      exteriorDistance.mul(exteriorDistance).mul(3.0).add(exteriorDistance.mul(1.5)).add(1.0)
    );
    // Half-wrapped N.L keeps soft fill on grazing surfaces while giving the
    // above/below/beside response; where the gradient is too weak to trust
    // (deep outside the field, or dead-flat regions) fall back to isotropic.
    const wrappedNdotL = normalNode.dot(lightDirection).mul(0.5).add(0.5).pow(2.0);
    const gradientConfidence = gradientLength.smoothstep(0.00002, 0.0005);
    const directionalResponse = mix(float(1.0), wrappedNdotL.mul(0.9).add(0.1), gradientConfidence);
    const farVector = fireCenterWorld.sub(positionNode);
    const farDistanceSq = farVector.dot(farVector);
    const farDirection = farVector.div(farDistanceSq.sqrt().max(1e-5));
    const farNdotL = normalNode.dot(farDirection).mul(0.5).add(0.5).pow(2.0);
    // Soft-saturate the radial term (Reinhard) so a large bright fire raises
    // the wash sublinearly instead of flooding the scene flat: falloff shape
    // survives because the compression is monotonic in the raw term.
    const farRadialRaw = firePower.mul(0.006).div(farDistanceSq.mul(2.5).add(0.25));
    const farRadial = farRadialRaw.div(farRadialRaw.mul(1.5).add(1.0));
    const farSignal = metaColor.rgb.mul(farRadial).mul(farNdotL).mul(farFieldStrength);
    const nearSignal = sampleLatticeAt(positionNode).rgb
      .mul(exteriorFalloff)
      .mul(directionalResponse);
    return { signal: nearSignal.add(farSignal), lightDirection, gradientConfidence, wrappedNdotL, directionalResponse, exteriorFalloff, farSignal };
  };
  // Only the native clear depth is background. A .999 cutoff rejects real
  // surfaces ~9.1 units away with this camera's .01/100 near/far planes,
  // sweeping a false lighting boundary across the kiln during camera dolly.
  const backgroundMask = float(1.0).sub(step(float(1.0), depthSampleNode));
  const normalSampleNode = sceneNormalNode.sample(viewportUV).rgb.normalize();
  // The prepass stores view-space normals; rotate into world space with the
  // scene camera's world matrix (w = 0 keeps it a pure rotation).
  const worldNormalNode = sceneCameraWorldMatrix.mul(vec4(normalSampleNode, 0.0)).xyz.normalize();
  const materialResponse = baseOutputNode.rgb.mul(0.65).add(vec3(0.35));
  const fireShadow = createFireLightFieldShadow({renderer,scene,
    sourceNode:fireCenterWorld,receiverNode:worldPositionNode,normalNode:worldNormalNode,
    requested:routeParams.get('volume_light_field_shadows') === '1'});
  const fireShadowCasters = createFireShadowCasters({scene, giProxies: sceneGiProxies, enabled: false});
  const renderFireShadow = () => {
    const lf = passState.lightField;
    const flameBox = Array.isArray(lf?.worldMin) && Array.isArray(lf?.worldMax)
      ? {min: lf.worldMin, max: lf.worldMax}
      : undefined;
    renderFireShadowBatch({scene, shadows: [fireShadow], casterScene: fireShadowCasters, flameBox});
  };
  const fireShadowVisibility = fireShadow.visibility;
  const pixelLight = fireLightAt(worldPositionNode, worldNormalNode);
  const { lightDirection, gradientConfidence, wrappedNdotL, directionalResponse, exteriorFalloff, farSignal } = pixelLight;
  const receiverSignal = pixelLight.signal
    .mul(fireShadowVisibility)
    .mul(backgroundMask)
    .mul(materialResponse)
    .mul(fireLightFieldStrength);
  const compositeOutput = baseOutputNode.add(vec4(receiverSignal, 0.0));
  const isolateOutput = vec4(
    baseOutputNode.rgb.mul(0.08).mul(backgroundMask).add(receiverSignal),
    1.0
  );
  let outputNode = mix(compositeOutput, isolateOutput, isolateMix);
  // Compile-time diagnostic views (route volume_light_field_debug=uvw|lattice|mask).
  if (debugView === 'uvw') {
    outputNode = vec4(latticeUvw, 1.0);
  } else if (debugView === 'lattice') {
    outputNode = vec4(latticeSample.rgb.mul(4.0), 1.0);
  } else if (debugView === 'mask') {
    outputNode = vec4(backgroundMask, directionalResponse, exteriorFalloff, 1.0);
  } else if (debugView === 'direction') {
    // Incident light direction as RGB (world axes mapped [-1,1] -> [0,1]),
    // alpha-carried confidence; geometry only.
    outputNode = vec4(lightDirection.mul(0.5).add(vec3(0.5)).mul(backgroundMask).mul(gradientConfidence), 1.0);
  } else if (debugView === 'ndotl') {
    outputNode = vec4(vec3(wrappedNdotL.mul(backgroundMask)), 1.0);
  } else if (debugView === 'far') {
    outputNode = vec4(farSignal.mul(4.0).mul(backgroundMask), 1.0);
  } else if (debugView === 'atlas') {
    outputNode = vec4(atlasTextureNode.sample(viewportUV).rgb.mul(4.0), 1.0);
  } else if (debugView === 'groundtest') {
    // World-coordinate readout for the unflipped reconstruction:
    // R = worldY mapped [-2,2] -> [0,1]; G = worldZ mapped [-4,4] -> [0,1];
    // B = geometry mask.
    const altView = getViewPosition(vec2(viewportUV.x, viewportUV.y.oneMinus()), depthSampleNode, sceneProjectionMatrixInverse);
    const altWorld = sceneCameraWorldMatrix.mul(vec4(altView, 1.0)).xyz;
    const primaryHit = float(1.0).sub(step(float(0.1), worldPositionNode.y.add(0.85).abs()));
    const altHit = float(1.0).sub(step(float(0.1), altWorld.y.add(0.85).abs()));
    outputNode = vec4(primaryHit, altHit, backgroundMask.mul(0.5), 1.0);
  } else if (debugView === 'slab') {
    // Exercise the exact tile/trilinear math over a fixed mid-depth slab.
    const slabTexel = vec2(viewportUV.x.mul(atlasGrid), float(1.0).sub(viewportUV.y).mul(atlasGridY)).clamp(vec2(0.5), vec2(atlasGrid, atlasGridY).sub(0.5));
    const slabSliceCoord = float(0.5).mul(atlasGrid).sub(0.5);
    const slabSlice0 = floor(slabSliceCoord);
    const slabTile = vec2(mod(slabSlice0, atlasTilesX), floor(slabSlice0.div(atlasTilesX)));
    const slabUv = vec2(slabTile.x.mul(atlasGrid).add(slabTexel.x), slabTile.y.mul(atlasGridY).add(slabTexel.y)).mul(atlasTexelSize);
    outputNode = vec4(atlasTextureNode.sample(slabUv).rgb.mul(4.0), 1.0);
  }

  const passState = {
    identity: FIRE_LIGHT_FIELD_PASS_IDENTITY,
    maskAuthority: FIRE_LIGHT_FIELD_MASK_AUTHORITY,
    atlasIdentity: FIRE_LIGHT_FIELD_ATLAS_IDENTITY,
    requested: true,
    effective: false,
    reason: 'fire-light-field-not-polled-yet',
    adoptionKey: null,
    sameDevice: false,
    witnessMuted: false,
    isolate: (routeParams.get('volume_light_field_isolate')==='1'),
    baseStrength,
    gainStops: 0,
    lightField: null,
    cpuReadbackAuthority: false,
    canvasBridgeAuthority: false,
    fallbackAuthority: false,
  };

  // Adoption swaps a fresh THREE.ExternalTexture into the texture node's
  // public value slot; no renderer-internal cache surgery.
  const makeAdoptedAtlasTexture = (sourceTexture, width, height) => {
    const adopted = new THREE.ExternalTexture(sourceTexture);
    adopted.image = { width, height, depth: 1 };
    adopted.format = THREE.RGBAFormat;
    adopted.type = THREE.HalfFloatType;
    adopted.colorSpace = THREE.NoColorSpace;
    adopted.minFilter = THREE.LinearFilter;
    adopted.magFilter = THREE.LinearFilter;
    adopted.generateMipmaps = false;
    return adopted;
  };

  const bindBlackAtlas = (reason) => {
    if (passState.adoptionKey !== 'black') {
      atlasTextureNode.value = atlasExternalTexture;
      metaTextureNode.value = metaExternalTexture;
      passState.adoptionKey = 'black';
      passState.farFieldIdentity = null;
    }
    passState.effective = false;
    passState.reason = reason;
    passState.sameDevice = false;
    fireLightFieldStrength.value = 0;
    fireShadowCasters.setEnabled(false);
  };

  // World-point probes: the same fire light and shadow, evaluated at listed
  // world points (e.g. around creatures) instead of screen pixels, so what is
  // sensed does not depend on where the camera looks. Results read back async.
  const lightProbe = { count: 0, shadow: true, positions: null, normals: null, results: null, node: null, busy: null };
  const buildLightProbe = (count, shadow) => {
    lightProbe.count = count; lightProbe.shadow = shadow;
    lightProbe.positions = new THREE.StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
    lightProbe.normals = new THREE.StorageInstancedBufferAttribute(new Float32Array(count * 4), 4);
    // One extra slot after the points carries the fire's own output (color, power).
    lightProbe.results = new THREE.StorageInstancedBufferAttribute(new Float32Array((count + 2) * 4), 4);
    const positionsNode = TSL.storage(lightProbe.positions, 'vec4', count);
    const normalsNode = TSL.storage(lightProbe.normals, 'vec4', count);
    const resultsNode = TSL.storage(lightProbe.results, 'vec4', count + 2);
    lightProbe.node = Fn(() => {
      const pointIndex = TSL.instanceIndex.min(TSL.uint(count - 1));
      const point = positionsNode.element(pointIndex).xyz;
      const normal = normalsNode.element(pointIndex).xyz.normalize();
      const visible = shadow ? fireShadow.visibilityAt(point, normal) : float(1.0);
      const atPoint = vec4(fireLightAt(point, normal).signal.mul(visible).mul(fireLightFieldStrength), visible);
      resultsNode.element(TSL.instanceIndex).assign(TSL.select(TSL.instanceIndex.equal(TSL.uint(count)), vec4(metaColor.rgb, firePower.mul(fireLightFieldStrength)), TSL.select(TSL.instanceIndex.equal(TSL.uint(count + 1)), vec4(emissionWorldCenter, emissionWorldRadius), atPoint)));
    })().compute(count + 2);
  };
  const probeLight = async (points, { shadow = true } = {}) => {
    if (!Array.isArray(points) || points.some(p => !Array.isArray(p?.position) || p.position.length !== 3 || !p.position.every(Number.isFinite)))
      throw new Error('Fire light probe requires points with finite [x,y,z] positions');
    if (!passState.effective) return { status: 'unavailable', reason: passState.reason, values: null };
    if (!points.length) return { status: 'effective', values: [] };
    while (lightProbe.busy) await lightProbe.busy;
    if (shadow && !fireShadow.debugState().effective) renderFireShadow();
    if (lightProbe.count !== points.length || lightProbe.shadow !== shadow) buildLightProbe(points.length, shadow);
    const position = lightProbe.positions.array, normal = lightProbe.normals.array;
    points.forEach((p, i) => { position.set([...p.position, 1], i * 4); normal.set([...(p.normal ?? [0, 1, 0]), 0], i * 4); });
    lightProbe.positions.needsUpdate = true; lightProbe.normals.needsUpdate = true;
    const run = (async () => {
      await renderer.computeAsync(lightProbe.node);
      return new Float32Array(await renderer.getArrayBufferAsync(lightProbe.results));
    })();
    lightProbe.busy = run.catch(() => {});
    try {
      const raw = await run;
      const n = points.length * 4;
      return { status: 'effective', identity: 'fire-light-field-world-point-probe-v0', source: { color: [raw[n], raw[n + 1], raw[n + 2]], power: raw[n + 3], visual: passState.lightField?.visualExtentIdentity === 'undiffused-emission-moments-v1' ? {center: [raw[n + 4], raw[n + 5], raw[n + 6]], radius: raw[n + 7], provenance: 'undiffused-emission-moments-v1'} : null }, values: points.map((_, i) => ({
        rgb: [raw[i * 4], raw[i * 4 + 1], raw[i * 4 + 2]], visibility: raw[i * 4 + 3],
        luminance: raw[i * 4] * 0.2126 + raw[i * 4 + 1] * 0.7152 + raw[i * 4 + 2] * 0.0722 })) };
    } finally { lightProbe.busy = null; }
  };
  return {
    outputNode,
    probeLight,
    renderShadows() {
      const shouldRender = passState.effective && (!passState.witnessMuted || passState.isolate);
      fireShadowCasters.setEnabled(shouldRender);
      if (shouldRender) renderFireShadow();
    },
    setShadowsEnabled(enabled) { return fireShadow.setEnabled(enabled); },
    diagnoseShadows(anchors) {
      if (passState.effective && !fireShadow.debugState().effective) renderFireShadow();
      return fireShadow.diagnose(anchors,camera.position.toArray());
    },
    update() {
      camera.updateMatrixWorld();
      sceneProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      sceneCameraWorldMatrix.value.copy(camera.matrixWorld);
      const lightField = readLightField() ?? null;
      passState.lightField = lightField ? { ...lightField, atlasTexture: undefined, device: undefined } : null;
      const sameDevice = !!lightField && lightField.device === sharedGpu.device;
      if (
        !lightField
        || lightField.status !== 'effective'
        || lightField.identity !== FIRE_LIGHT_FIELD_ATLAS_IDENTITY
        || !sameDevice
        || !lightField.atlasTexture
      ) {
        bindBlackAtlas(
          !lightField
            ? 'volume-prototype-light-field-unavailable'
            : (!sameDevice && lightField.status === 'effective'
              ? 'producer-consumer-device-mismatch'
              : lightField.reason || `light-field-${lightField.status}`)
        );
        return false;
      }
      const adoptionKey = `${lightField.generation}:${lightField.atlasWidth}x${lightField.atlasHeight}`;
      if (passState.adoptionKey !== adoptionKey) {
        atlasTextureNode.value = makeAdoptedAtlasTexture(lightField.atlasTexture, lightField.atlasWidth, lightField.atlasHeight);
        if (lightField.metaTexture && lightField.metaWidth === 4 && lightField.visualExtentIdentity === 'undiffused-emission-moments-v1') {
          const adoptedMeta = makeAdoptedAtlasTexture(lightField.metaTexture, lightField.metaWidth, lightField.metaHeight);
          adoptedMeta.minFilter = THREE.NearestFilter;
          adoptedMeta.magFilter = THREE.NearestFilter;
          metaTextureNode.value = adoptedMeta;
        } else {
          metaTextureNode.value = metaExternalTexture;
        }
        passState.adoptionKey = adoptionKey;
        passState.farFieldIdentity = lightField.farFieldIdentity ?? null;
        atlasGrid.value = lightField.grid;
        atlasGridY.value = lightField.gridY;
        fieldWorldMin.value.set(...lightField.worldMin);
        fieldWorldMax.value.set(...lightField.worldMax);
        fieldCellPitch.value = (lightField.worldMax[0] - lightField.worldMin[0]) / lightField.grid;
        atlasTilesX.value = lightField.tilesX;
        atlasTexelSize.value.set(1 / lightField.atlasWidth, 1 / lightField.atlasHeight);
      }
      passState.effective = true;
      passState.reason = null;
      passState.sameDevice = true;
      fireLightFieldStrength.value = passState.witnessMuted ? 0 : passState.baseStrength * Math.pow(2, passState.gainStops || 0);
      return true;
    },
    setWitnessMute(muted) {
      passState.witnessMuted = muted === true;
      fireLightFieldStrength.value = passState.witnessMuted ? 0 : (passState.effective ? passState.baseStrength * Math.pow(2, passState.gainStops || 0) : 0);
      return {
        identity: 'fire-light-field-witness-mute-v0',
        muted: passState.witnessMuted,
        strength: fireLightFieldStrength.value,
      };
    },
    setGainStops(stops) {
      passState.gainStops = Number.isFinite(Number(stops)) ? Math.max(-6, Math.min(6, Number(stops))) : 0;
      return {
        identity: 'fire-light-field-gain-stops-v0',
        gainStops: passState.gainStops,
        multiplier: Math.pow(2, passState.gainStops),
      };
    },
    setWitnessIsolate(isolate) {
      passState.isolate = isolate === true;
      isolateMix.value = passState.isolate ? 1 : 0;
      return {
        identity: 'fire-light-field-witness-isolate-v0',
        isolate: passState.isolate,
        isolateMix: isolateMix.value,
      };
    },
    debugState() {
      return {
        ...passState,
        strength: fireLightFieldStrength.value,
        isolateMix: isolateMix.value,
        atlasGrid: atlasGrid.value,
        shadow: fireShadow.debugState(),
        sharedDeviceIdentity: sharedGpu?.identity ?? null,
      };
    },
    dispose() {
      fireShadowCasters.dispose();
      fireShadow.dispose();
      blackAtlasTexture.destroy?.();
      blackMetaTexture.destroy?.();
    },
  };
}
