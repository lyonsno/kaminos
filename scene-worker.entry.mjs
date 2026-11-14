import * as THREE from './lib/three.webgpu.js';
import controlDefinitions from 'kaminos:worker-control-definitions';
import {installSceneWorkerHost} from './scene-worker-handoff.mjs';
import {createSceneWorkerRuntimeFactory} from './scene-worker-runtime.mjs';
import {createSceneWorkerSceneResources} from './scene-worker-scene-resources.mjs';
import {createSceneWorkerFireResources} from './scene-worker-fire-resources.mjs';
import {createAuthoringImageServingOptions} from './authoring-image-serving.mjs';

if(typeof DedicatedWorkerGlobalScope==='undefined'||!(globalThis instanceof DedicatedWorkerGlobalScope))throw Error('The shared scene entry requires a DedicatedWorkerGlobalScope');
const createRuntime=createSceneWorkerRuntimeFactory({THREE,imageOptions:createAuthoringImageServingOptions(),assetOptions:{},
 createSceneResources:context=>createSceneWorkerSceneResources({...context,
  createDomains:local=>createSceneWorkerFireResources(local,{definitions:controlDefinitions})})});
installSceneWorkerHost({port:globalThis,createRuntime});
