/**
 * GTAO Compute Pipeline for Three.js WebGPU.
 *
 * Wraps the WGSL compute shaders into a Three.js-friendly API that integrates
 * with the WebGPU renderer's render loop. Call update() after the scene renders
 * to dispatch the AO compute passes, then read the AO texture for compositing.
 *
 * Usage:
 *   const aoPipeline = new GTAOComputePipeline(renderer, camera, width, height);
 *   // In render loop after scene renders:
 *   aoPipeline.update(renderer);
 *   // aoPipeline.aoTexture is the result (r32float, 0=occluded, 1=visible)
 */

import * as THREE from 'three';
import { DEPTH_PREFILTER_WGSL, GTAO_MAIN_WGSL, DENOISE_WGSL } from './ao-compute.js';

class GTAOComputePipeline {
  constructor(renderer, camera, width, height) {
    this.renderer = renderer;
    this.camera = camera;
    this.width = width;
    this.height = height;

    // Parameters
    this.radius = 0.5;       // world-space radius
    this.falloffEnd = 3.0;   // max distance for AO
    this.intensity = 1.5;
    this.sliceCount = 3;
    this.stepsPerSlice = 3;
    this.denoiseStrength = 40.0;

    this._frameCounter = 0;
    this._ready = false;
    this._initPromise = this._init();
  }

  async _init() {
    const device = this.renderer.backend?.device;
    if (!device) {
      console.warn('GTAOComputePipeline: WebGPU device not available, AO disabled');
      return;
    }

    this._device = device;
    this._createTextures();
    this._createPipelines();
    this._ready = true;
    console.log('GTAO compute pipeline initialized');
  }

  _createTextures() {
    const device = this._device;
    const w = this.width;
    const h = this.height;

    // MIP chain textures (storage + sampled)
    const mipSizes = [
      [w, h],
      [Math.ceil(w/2), Math.ceil(h/2)],
      [Math.ceil(w/4), Math.ceil(h/4)],
      [Math.ceil(w/8), Math.ceil(h/8)],
      [Math.ceil(w/16), Math.ceil(h/16)],
    ];

    this._mipTextures = mipSizes.map(([mw, mh]) =>
      device.createTexture({
        size: [mw, mh, 1],
        format: 'r32float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      })
    );

    // Raw AO output
    this._aoRawTexture = device.createTexture({
      size: [w, h, 1],
      format: 'r32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Denoised AO output (final)
    this._aoFinalTexture = device.createTexture({
      size: [w, h, 1],
      format: 'r32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Sampler for depth MIPs
    this._sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // Uniform buffers
    this._prefilterUniformBuffer = device.createBuffer({
      size: 32, // vec4 + vec2 + vec2
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._gtaoUniformBuffer = device.createBuffer({
      size: 48, // vec4 + vec2 + 6 scalars
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this._denoiseUniformBuffer = device.createBuffer({
      size: 16, // vec2 + f32 + pad
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  _createPipelines() {
    const device = this._device;

    // Depth prefilter pipeline
    this._prefilterPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: DEPTH_PREFILTER_WGSL }),
        entryPoint: 'main',
      },
    });

    // GTAO main pipeline
    this._gtaoPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: GTAO_MAIN_WGSL }),
        entryPoint: 'main',
      },
    });

    // Denoise pipeline
    this._denoisePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: DENOISE_WGSL }),
        entryPoint: 'main',
      },
    });
  }

  /**
   * Get the projection info vec4 for screen-space to view-space reconstruction.
   */
  _getProjInfo() {
    const proj = this.camera.projectionMatrix.elements;
    // projInfo: allows reconstructing view-space position from UV + linear depth
    // viewPos.x = (uv.x * projInfo.x + projInfo.z) * depth
    // viewPos.y = (uv.y * projInfo.y + projInfo.w) * depth
    return new Float32Array([
      2.0 / proj[0],                    // 2 / proj[0][0]
      2.0 / proj[5],                    // 2 / proj[1][1]
      -1.0 / proj[0],                   // -1 / proj[0][0]
      -1.0 / proj[5],                   // -1 / proj[1][1]
    ]);
  }

  /**
   * Dispatch compute passes. Call after the scene has been rendered
   * (so depth buffer is populated).
   *
   * @param {GPUTexture} depthTexture - The depth texture from the scene render
   */
  dispatch(depthTexture) {
    if (!this._ready || !depthTexture) return;

    const device = this._device;
    const w = this.width;
    const h = this.height;

    // Update uniforms
    const projInfo = this._getProjInfo();
    const prefilterData = new Float32Array([
      ...projInfo,
      this.camera.near, this.camera.far,
      w, h,
    ]);
    device.queue.writeBuffer(this._prefilterUniformBuffer, 0, prefilterData);

    const gtaoData = new Float32Array([
      ...projInfo,
      w, h,
      this.radius,
      this.falloffEnd,
    ]);
    const gtaoDataU32 = new Uint32Array([
      this.sliceCount, this.stepsPerSlice, this._frameCounter++, 0,
    ]);
    const gtaoIntensity = new Float32Array([this.intensity, 0, 0, 0]);
    device.queue.writeBuffer(this._gtaoUniformBuffer, 0, gtaoData);
    device.queue.writeBuffer(this._gtaoUniformBuffer, 32, gtaoDataU32);
    device.queue.writeBuffer(this._gtaoUniformBuffer, 48 - 16, gtaoIntensity);

    const denoiseData = new Float32Array([w, h, this.denoiseStrength, 0]);
    device.queue.writeBuffer(this._denoiseUniformBuffer, 0, denoiseData);

    const encoder = device.createCommandEncoder();

    // Pass 1: Depth prefilter
    const prefilterBindGroup = device.createBindGroup({
      layout: this._prefilterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: depthTexture.createView() },
        { binding: 1, resource: this._mipTextures[0].createView() },
        { binding: 2, resource: this._mipTextures[1].createView() },
        { binding: 3, resource: this._mipTextures[2].createView() },
        { binding: 4, resource: this._mipTextures[3].createView() },
        { binding: 5, resource: this._mipTextures[4].createView() },
        { binding: 6, resource: { buffer: this._prefilterUniformBuffer } },
      ],
    });

    const prefilterPass = encoder.beginComputePass();
    prefilterPass.setPipeline(this._prefilterPipeline);
    prefilterPass.setBindGroup(0, prefilterBindGroup);
    prefilterPass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16));
    prefilterPass.end();

    // Pass 2: GTAO main
    const gtaoBindGroup = device.createBindGroup({
      layout: this._gtaoPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this._mipTextures[0].createView() },
        { binding: 1, resource: this._mipTextures[1].createView() },
        { binding: 2, resource: this._mipTextures[2].createView() },
        { binding: 3, resource: this._mipTextures[3].createView() },
        { binding: 4, resource: this._mipTextures[4].createView() },
        { binding: 5, resource: this._sampler },
        { binding: 6, resource: this._aoRawTexture.createView() },
        { binding: 7, resource: { buffer: this._gtaoUniformBuffer } },
      ],
    });

    const gtaoPass = encoder.beginComputePass();
    gtaoPass.setPipeline(this._gtaoPipeline);
    gtaoPass.setBindGroup(0, gtaoBindGroup);
    gtaoPass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
    gtaoPass.end();

    // Pass 3: Denoise
    const denoiseBindGroup = device.createBindGroup({
      layout: this._denoisePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this._aoRawTexture.createView() },
        { binding: 1, resource: this._mipTextures[0].createView() },
        { binding: 2, resource: this._aoFinalTexture.createView() },
        { binding: 3, resource: { buffer: this._denoiseUniformBuffer } },
        { binding: 4, resource: this._sampler },
      ],
    });

    const denoisePass = encoder.beginComputePass();
    denoisePass.setPipeline(this._denoisePipeline);
    denoisePass.setBindGroup(0, denoiseBindGroup);
    denoisePass.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16));
    denoisePass.end();

    device.queue.submit([encoder.finish()]);
  }

  get aoTexture() {
    return this._aoFinalTexture;
  }

  get isReady() {
    return this._ready;
  }

  setSize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (this._ready) {
      this._destroyTextures();
      this._createTextures();
    }
  }

  _destroyTextures() {
    this._mipTextures?.forEach(t => t.destroy());
    this._aoRawTexture?.destroy();
    this._aoFinalTexture?.destroy();
    this._prefilterUniformBuffer?.destroy();
    this._gtaoUniformBuffer?.destroy();
    this._denoiseUniformBuffer?.destroy();
  }

  dispose() {
    this._destroyTextures();
    this._ready = false;
  }
}

export { GTAOComputePipeline };
