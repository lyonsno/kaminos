import importlib.util,json,os,subprocess,sys
from pathlib import Path
script=Path(__file__).resolve().parents[1]/'process-memory.py'
assert script.exists(),'owned-process physical footprint must be observed, not inferred from cumulative model bytes'
spec=importlib.util.spec_from_file_location('trellis_process_memory',script);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
good=module.sample_owned_processes(os.getpid(),'observed-test')
assert good['status']=='observed',good
row=next(x for x in good['processes'] if x['pid']==os.getpid())
assert row['physicalFootprintBytes']>0 and row['residentBytes']>0 and row['kernelLifetimePeakPhysicalFootprintBytes']>=row['physicalFootprintBytes']
assert row['processStartAbstime']>0 and good['effectiveRoute'].endswith('RUSAGE_INFO_V4')
bad=module.sample_owned_processes(2147483647,'missing-owner')
assert bad['status']=='unavailable' and bad['processes']==[] and bad['sampledAggregatePhysicalFootprintBytes'] is None
print('Actual Darwin libproc reports owned-process footprint/lifetime peak and identity; a missing root is unavailable, never zero-memory success.')
