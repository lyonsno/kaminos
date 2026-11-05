import {readFileSync} from 'node:fs';
import {createThermalSubmission} from '../../volume-thermal-submission.mjs';

// Extract the real command bridge so frame fixtures retain submission ordering.
export function volumeSubmissionContext(device) {
  const core=readFileSync(new URL('../../volume-core.js',import.meta.url),'utf8');
  const start=core.indexOf('  const thermalSubmissions=createThermalSubmission();');
  const end=core.indexOf('  let thermalFluidGeneration =',start);
  if(start<0||end<start)throw Error('Missing production thermal submission bridge');
  return new Function('device','createThermalSubmission',core.slice(start,end)
    +'return {finishVolumeEncoder,submitVolumeCommands};')(device,createThermalSubmission);
}
