import { fluidBrowserLaunch } from './finger-fluid-browser-launch.mjs';

// Same native viewport flags exercised by scene-object-witness. Record the
// complete effective argv, not only the common browser helper's prefix.
export function pipelineUiBrowserLaunch(config) {
  const launch=fluidBrowserLaunch(config);
  return {...launch,args:[...launch.args.slice(0,-1),'--headless=new','--disable-gpu-sandbox',
    '--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','about:blank']};
}

export function pipelineViewportErrors(events) {
  return events.filter(event=>event.method==='Runtime.consoleAPICalled' && event.params?.type==='error')
    .flatMap(event=>(event.params.args??[]).map(arg=>arg.value??arg.description??''))
    .filter(text=>typeof text==='string' && /THREE\.WebGPURenderer: (?:Render pipeline creation failed|Uncaptured WebGPU)/.test(text));
}
