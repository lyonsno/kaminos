/**
 * Horizon-Based Ambient Occlusion (HBAO) pass for Three.js EffectComposer.
 *
 * Multi-scale screen-space AO with bilateral denoise. Samples horizon angles
 * along random directions in screen space, computes occlusion from the solid
 * angle below the tangent plane, and blends two radius tiers for both fine
 * crevice detail and broad contact shadows.
 *
 * Requires a scene rendered with a MeshNormalMaterial override to produce
 * a normal buffer, plus the depth buffer from the EffectComposer.
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// --- Noise texture ---
function createNoiseTexture(size = 4) {
  const data = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const angle = Math.random() * Math.PI * 2;
    data[i * 4 + 0] = Math.cos(angle);
    data[i * 4 + 1] = Math.sin(angle);
    data[i * 4 + 2] = Math.random(); // random offset for step jitter
    data[i * 4 + 3] = 1.0;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

// --- HBAO shader ---
const HBAOShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    tNormal: { value: null },
    tNoise: { value: null },
    resolution: { value: new THREE.Vector2() },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 100 },
    projMatrix: { value: new THREE.Matrix4() },
    invProjMatrix: { value: new THREE.Matrix4() },
    radius: { value: 0.5 },
    radiusFar: { value: 2.0 },
    intensity: { value: 1.5 },
    bias: { value: 0.02 },
    directions: { value: 8 },
    steps: { value: 4 },
    farBlend: { value: 0.5 },
    frameIndex: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform sampler2D tNormal;
    uniform sampler2D tNoise;
    uniform vec2 resolution;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform mat4 projMatrix;
    uniform mat4 invProjMatrix;
    uniform float radius;
    uniform float radiusFar;
    uniform float intensity;
    uniform float bias;
    uniform int directions;
    uniform int steps;
    uniform float farBlend;
    uniform int frameIndex;

    varying vec2 vUv;

    float linearDepth(float d) {
      return cameraNear * cameraFar / (cameraFar - d * (cameraFar - cameraNear));
    }

    vec3 viewPosFromDepth(vec2 uv, float depth) {
      vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 view = invProjMatrix * clip;
      return view.xyz / view.w;
    }

    vec3 decodeNormal(vec2 uv) {
      vec3 n = texture2D(tNormal, uv).xyz * 2.0 - 1.0;
      return normalize(n);
    }

    // Interleaved gradient noise — no texture fetch, purely arithmetic
    float interleavedGradientNoise(vec2 p) {
      return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
    }

    float computeHBAO(vec3 viewPos, vec3 viewNormal, float r, vec2 noiseDir, float jitter) {
      float ao = 0.0;
      float pixelRadius = r * projMatrix[0][0] * resolution.x * 0.5 / (-viewPos.z);
      pixelRadius = max(pixelRadius, 3.0);
      pixelRadius = min(pixelRadius, min(resolution.x, resolution.y) * 0.25);
      float stepSize = pixelRadius / float(steps);

      float dirCount = float(directions);
      for (int d = 0; d < 32; d++) {
        if (d >= directions) break;
        float angle = (float(d) + jitter) / dirCount * 3.14159265 * 2.0;
        // Rotate base noise direction
        vec2 dir = vec2(
          cos(angle) * noiseDir.x - sin(angle) * noiseDir.y,
          sin(angle) * noiseDir.x + cos(angle) * noiseDir.y
        );

        float maxHorizon = -1.0;
        for (int s = 1; s <= 16; s++) {
          if (s > steps) break;
          float t = (float(s) + jitter * 0.5) * stepSize;
          vec2 sampleUV = vUv + dir * t / resolution;
          if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) break;

          float sDepth = texture2D(tDepth, sampleUV).r;
          vec3 sPos = viewPosFromDepth(sampleUV, sDepth);
          vec3 diff = sPos - viewPos;
          float dist = length(diff);
          if (dist < 0.001) continue;

          // Horizon angle: sin of angle between tangent plane and sample direction
          float h = dot(diff, viewNormal) / dist;

          // Distance attenuation
          float atten = max(0.0, 1.0 - dist * dist / (r * r));
          h = mix(0.0, h, atten);

          maxHorizon = max(maxHorizon, h);
        }
        ao += max(0.0, maxHorizon - bias);
      }
      ao /= dirCount;
      return ao;
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).r;

      // Skip background
      if (depth >= 1.0) {
        gl_FragColor = color;
        return;
      }

      vec3 viewPos = viewPosFromDepth(vUv, depth);
      vec3 viewNormal = decodeNormal(vUv);

      // Noise for jittering
      vec4 noise = texture2D(tNoise, vUv * resolution / 4.0);
      vec2 noiseDir = normalize(noise.xy * 2.0 - 1.0 + 0.001);
      float jitter = interleavedGradientNoise(gl_FragCoord.xy + float(frameIndex) * 73.0);

      // Two-scale AO: fine + coarse
      float aoFine = computeHBAO(viewPos, viewNormal, radius, noiseDir, jitter);
      float aoCoarse = computeHBAO(viewPos, viewNormal, radiusFar, noiseDir, jitter);
      float ao = mix(aoFine, aoCoarse, farBlend);

      float occlusion = 1.0 - ao * intensity;
      occlusion = clamp(occlusion, 0.0, 1.0);

      gl_FragColor = vec4(color.rgb * occlusion, color.a);
    }
  `,
};

// --- Bilateral blur shader ---
const BilateralBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    resolution: { value: new THREE.Vector2() },
    direction: { value: new THREE.Vector2(1, 0) },
    cameraNear: { value: 0.1 },
    cameraFar: { value: 100 },
    sharpness: { value: 40.0 },
    kernelRadius: { value: 4 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 resolution;
    uniform vec2 direction;
    uniform float cameraNear;
    uniform float cameraFar;
    uniform float sharpness;
    uniform int kernelRadius;

    varying vec2 vUv;

    float linearDepth(float d) {
      return cameraNear * cameraFar / (cameraFar - d * (cameraFar - cameraNear));
    }

    void main() {
      vec4 center = texture2D(tDiffuse, vUv);
      float centerDepth = linearDepth(texture2D(tDepth, vUv).r);
      vec2 texelSize = direction / resolution;

      vec4 result = center;
      float totalWeight = 1.0;

      for (int i = 1; i <= 8; i++) {
        if (i > kernelRadius) break;
        float fi = float(i);
        float gaussWeight = exp(-fi * fi / 8.0);

        for (float sign = -1.0; sign <= 1.0; sign += 2.0) {
          vec2 offset = texelSize * fi * sign;
          vec2 sampleUV = vUv + offset;
          if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;

          vec4 s = texture2D(tDiffuse, sampleUV);
          float sDepth = linearDepth(texture2D(tDepth, sampleUV).r);

          float depthDiff = abs(centerDepth - sDepth);
          float depthWeight = exp(-depthDiff * sharpness);

          float w = gaussWeight * depthWeight;
          result += s * w;
          totalWeight += w;
        }
      }

      gl_FragColor = result / totalWeight;
    }
  `,
};

// --- HBAO Pass ---
class HBAOPass extends Pass {
  constructor(scene, camera, width, height) {
    super();

    this.scene = scene;
    this.camera = camera;
    this.width = width;
    this.height = height;

    // Parameters
    this.radius = 0.5;
    this.radiusFar = 2.0;
    this.intensity = 1.5;
    this.bias = 0.02;
    this.directions = 8;
    this.steps = 4;
    this.farBlend = 0.5;
    this.blurRadius = 4;
    this.blurSharpness = 40.0;

    this._frameIndex = 0;

    // Normal render target
    this._normalTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    });

    // Depth render target (from main render)
    this._depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this._depthTarget.depthTexture = new THREE.DepthTexture(width, height);
    this._depthTarget.depthTexture.format = THREE.DepthFormat;
    this._depthTarget.depthTexture.type = THREE.UnsignedIntType;

    // AO targets (ping-pong for blur)
    this._aoTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this._blurTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // Normal material override
    this._normalMaterial = new THREE.MeshNormalMaterial();

    // Noise
    this._noiseTex = createNoiseTexture(4);

    // HBAO material
    this._hbaoMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(HBAOShader.uniforms),
      vertexShader: HBAOShader.vertexShader,
      fragmentShader: HBAOShader.fragmentShader,
      depthWrite: false,
    });
    this._hbaoMaterial.uniforms.tNoise.value = this._noiseTex;

    // Blur materials (H and V)
    this._blurHMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BilateralBlurShader.uniforms),
      vertexShader: BilateralBlurShader.vertexShader,
      fragmentShader: BilateralBlurShader.fragmentShader,
      depthWrite: false,
    });
    this._blurHMaterial.uniforms.direction.value.set(1, 0);

    this._blurVMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(BilateralBlurShader.uniforms),
      vertexShader: BilateralBlurShader.vertexShader,
      fragmentShader: BilateralBlurShader.fragmentShader,
      depthWrite: false,
    });
    this._blurVMaterial.uniforms.direction.value.set(0, 1);

    this._fsQuad = new FullScreenQuad();
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this._normalTarget.setSize(width, height);
    this._depthTarget.setSize(width, height);
    this._aoTarget.setSize(width, height);
    this._blurTarget.setSize(width, height);
  }

  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    if (!this.enabled) return;

    const cam = this.camera;

    // 1. Render normals
    const prevOverride = this.scene.overrideMaterial;
    const prevBg = this.scene.background;
    this.scene.overrideMaterial = this._normalMaterial;
    this.scene.background = null;
    renderer.setRenderTarget(this._normalTarget);
    renderer.clear();
    renderer.render(this.scene, cam);
    this.scene.overrideMaterial = prevOverride;
    this.scene.background = prevBg;

    // 2. Render depth
    renderer.setRenderTarget(this._depthTarget);
    renderer.clear();
    renderer.render(this.scene, cam);

    // 3. HBAO pass
    const hbaoUni = this._hbaoMaterial.uniforms;
    hbaoUni.tDiffuse.value = readBuffer.texture;
    hbaoUni.tDepth.value = this._depthTarget.depthTexture;
    hbaoUni.tNormal.value = this._normalTarget.texture;
    hbaoUni.resolution.value.set(this.width, this.height);
    hbaoUni.cameraNear.value = cam.near;
    hbaoUni.cameraFar.value = cam.far;
    hbaoUni.projMatrix.value.copy(cam.projectionMatrix);
    hbaoUni.invProjMatrix.value.copy(cam.projectionMatrixInverse);
    hbaoUni.radius.value = this.radius;
    hbaoUni.radiusFar.value = this.radiusFar;
    hbaoUni.intensity.value = this.intensity;
    hbaoUni.bias.value = this.bias;
    hbaoUni.directions.value = this.directions;
    hbaoUni.steps.value = this.steps;
    hbaoUni.farBlend.value = this.farBlend;
    hbaoUni.frameIndex.value = this._frameIndex++;

    this._fsQuad.material = this._hbaoMaterial;
    renderer.setRenderTarget(this._aoTarget);
    this._fsQuad.render(renderer);

    // 4. Bilateral blur H: _aoTarget → _blurTarget
    const blurH = this._blurHMaterial.uniforms;
    blurH.tDiffuse.value = this._aoTarget.texture;
    blurH.tDepth.value = this._depthTarget.depthTexture;
    blurH.resolution.value.set(this.width, this.height);
    blurH.cameraNear.value = cam.near;
    blurH.cameraFar.value = cam.far;
    blurH.sharpness.value = this.blurSharpness;
    blurH.kernelRadius.value = this.blurRadius;

    this._fsQuad.material = this._blurHMaterial;
    renderer.setRenderTarget(this._blurTarget);
    this._fsQuad.render(renderer);

    // 5. Bilateral blur V: _blurTarget → writeBuffer
    const blurV = this._blurVMaterial.uniforms;
    blurV.tDiffuse.value = this._blurTarget.texture;
    blurV.tDepth.value = this._depthTarget.depthTexture;
    blurV.resolution.value.set(this.width, this.height);
    blurV.cameraNear.value = cam.near;
    blurV.cameraFar.value = cam.far;
    blurV.sharpness.value = this.blurSharpness;
    blurV.kernelRadius.value = this.blurRadius;

    this._fsQuad.material = this._blurVMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this._fsQuad.render(renderer);
  }

  dispose() {
    this._normalTarget.dispose();
    this._depthTarget.dispose();
    this._depthTarget.depthTexture.dispose();
    this._aoTarget.dispose();
    this._blurTarget.dispose();
    this._normalMaterial.dispose();
    this._noiseTex.dispose();
    this._hbaoMaterial.dispose();
    this._blurHMaterial.dispose();
    this._blurVMaterial.dispose();
    this._fsQuad.dispose();
  }
}

export { HBAOPass };
