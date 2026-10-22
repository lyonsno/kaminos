export function assertRenderedEvidence(report) {
 if(report.errors.length)throw Error('Browser exceptions invalidate rendered evidence');
 if(report.console.some(e=>e.type==='error'||e.entry?.level==='error'))throw Error('Browser console errors invalidate rendered evidence');
 if(!report.console.some(e=>e.args?.some(a=>a.value==='WebGPUBackend')))throw Error('Effective WebGPU route was not observed');
}
