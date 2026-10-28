import {crownRecordDomain} from './compound-crown-record.mjs';
// Application installation only: payload meaning lives with each domain.
import {sceneAssetRecordDomains} from './scene-asset-records.mjs';
import {cameraRecordDomain} from './scene-camera.mjs';
import {spotLightRecordDomain} from './scene-spot-light.mjs';
import {proceduralMeshRecordDomain} from './scene-geometry.mjs';
import {fireSourceRecordDomain,fireDomainRecordDomain} from './scene-fire-domain.mjs';
import {localLiquidRecordDomain} from './local-liquid-setup.mjs';
import {promptReliefRecordDomain} from './inference-kiln-record.mjs';

export const sceneRecordDomains=Object.freeze([
  ...sceneAssetRecordDomains,cameraRecordDomain,spotLightRecordDomain,proceduralMeshRecordDomain,
  {...proceduralMeshRecordDomain,type:'burner-bed'},fireSourceRecordDomain,fireDomainRecordDomain,
  localLiquidRecordDomain,promptReliefRecordDomain,crownRecordDomain,
]);
