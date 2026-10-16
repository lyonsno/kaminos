import { WebGpuCommandDutyScheduler } from '../../webgpu-inference-kit/src/command-duty-scheduler.js';

export class KleinDutyScheduler extends WebGpuCommandDutyScheduler {
  constructor(device, options = {}) {
    super(device, { label: 'klein', model: 'flux2-klein', ...options });
  }
}
