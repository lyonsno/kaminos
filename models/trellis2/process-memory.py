"""One uncapped owned-process sample using actual Darwin libproc RUSAGE_INFO_V4."""
import argparse,ctypes,errno,json,os,subprocess,sys,time

# Exact current SDK sys/resource.h ABI: UUID16 plus35 uint64 fields, in declaration order.
FIELDS='user_time system_time pkg_idle_wkups interrupt_wkups pageins wired_size resident_size phys_footprint proc_start_abstime proc_exit_abstime child_user_time child_system_time child_pkg_idle_wkups child_interrupt_wkups child_pageins child_elapsed_abstime diskio_bytesread diskio_byteswritten cpu_time_qos_default cpu_time_qos_maintenance cpu_time_qos_background cpu_time_qos_utility cpu_time_qos_legacy cpu_time_qos_user_initiated cpu_time_qos_user_interactive billed_system_time serviced_system_time logical_writes lifetime_max_phys_footprint instructions cycles billed_energy serviced_energy interval_max_phys_footprint runnable_time'.split()
class RUsageInfoV4(ctypes.Structure):
    _fields_=[('uuid',ctypes.c_uint8*16)]+[(name,ctypes.c_uint64) for name in FIELDS]

class BSDShortInfo(ctypes.Structure):
    # Installed SDK sys/proc_info.h, PROC_PIDT_SHORTBSDINFO (13).
    _fields_=[(name,ctypes.c_uint32) for name in ('pid','ppid','pgid','status')]+[
        ('comm',ctypes.c_char*16)]+[(name,ctypes.c_uint32) for name in
        ('flags','uid','gid','ruid','rgid','svuid','svgid','reserved')]

def process_status(library,pid):
    info=BSDShortInfo();ctypes.set_errno(0)
    size=library.proc_pidinfo(pid,13,0,ctypes.byref(info),ctypes.sizeof(info))
    return info,{'route':'libproc-pid-status','pid':pid,'bytesReturned':size,
        'expectedBytes':ctypes.sizeof(info),'errno':ctypes.get_errno(),
        'observedPid':info.pid if size==ctypes.sizeof(info) else None,
        'statusCode':info.status if size==ctypes.sizeof(info) else None}

def owned_process_rows(library,root_pid):
    library.proc_listchildpids.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_int]
    library.proc_listchildpids.restype=ctypes.c_int
    library.proc_pidinfo.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.c_uint64,ctypes.c_void_p,ctypes.c_int]
    library.proc_pidinfo.restype=ctypes.c_int
    library.proc_pidpath.argtypes=[ctypes.c_int,ctypes.c_void_p,ctypes.c_uint32]
    library.proc_pidpath.restype=ctypes.c_int
    info,evidence=process_status(library,root_pid)
    if evidence['bytesReturned']!=ctypes.sizeof(info) or info.pid!=root_pid:
        reason='absent' if evidence['errno']==errno.ESRCH else 'identity unavailable'
        raise RuntimeError('owned root process '+reason+': '+json.dumps(evidence))
    rows={root_pid:{'pid':root_pid,'parentPid':info.ppid}}
    pending=[root_pid]
    while pending:
        parent=pending.pop()
        ctypes.set_errno(0)
        capacity=library.proc_listchildpids(parent,None,0)+1
        if ctypes.get_errno():raise OSError(ctypes.get_errno(),'owned child enumeration unavailable')
        # Query and fill are non-atomic. Grow and retry on a full buffer;
        # never cap or silently drop children if the tree expanded.
        while True:
            buffer=(ctypes.c_int*capacity)();ctypes.set_errno(0)
            count=library.proc_listchildpids(parent,buffer,ctypes.sizeof(buffer))
            if count<0 or ctypes.get_errno():raise OSError(ctypes.get_errno(),'owned child enumeration unavailable')
            if count<capacity:break
            capacity*=2
        for pid in buffer[:count]:
            if pid>0 and pid not in rows:
                rows[pid]={'pid':pid,'parentPid':parent};pending.append(pid)
    for pid,row in rows.items():
        path=ctypes.create_string_buffer(4096)
        size=library.proc_pidpath(pid,path,len(path))
        row['executable']=os.fsdecode(path.value) if size>0 else None
    return rows

def sample_owned_processes(root_pid,run_id):
    report={'schema':'trellis2.process-memory-sample.v0','runId':run_id,'rootPid':root_pid,'atUnixMs':time.time()*1000,
        'status':'unavailable','effectiveRoute':'darwin-libproc-proc_pid_rusage/RUSAGE_INFO_V4','processes':[],
        'sampledAggregatePhysicalFootprintBytes':None,'meaning':'concurrent owned-process charged footprint; not whole-machine usage or summed lifetime peaks'}
    if sys.platform!='darwin':report['error']='Darwin libproc route unavailable on '+sys.platform;return report
    try:
        library=ctypes.CDLL('/usr/lib/libproc.dylib',use_errno=True)
        library.proc_pid_rusage.argtypes=[ctypes.c_int,ctypes.c_int,ctypes.POINTER(RUsageInfoV4)]
        library.proc_pid_rusage.restype=ctypes.c_int
        rows=owned_process_rows(library,root_pid)
        report['processTreeRoute']='darwin-libproc-proc_listchildpids'
        for pid in sorted(rows):
            info=RUsageInfoV4();error=library.proc_pid_rusage(pid,4,ctypes.byref(info))
            if error:
                missing={**rows[pid],'errno':ctypes.get_errno(),
                    'expectedProbeExit':False}
                # The tree snapshot and libproc reads are not atomic. A short
                # source-attestation git child can exit between them. Only an
                # ESRCH/EPERM plus a fresh OS absence/zombie check proves retirement;
                # a live or inaccessible process remains missing coverage.
                if pid!=root_pid and missing['errno'] in (errno.ESRCH,errno.EPERM):
                    try:
                        info,evidence=process_status(library,pid)
                        missing['exitEvidence']=evidence
                        if ((evidence['bytesReturned']==0 and evidence['errno']==errno.ESRCH) or
                                (evidence['bytesReturned']==ctypes.sizeof(info) and info.pid==pid and info.status==5)):
                            missing['exitedBeforeMeasurement']=True
                    except Exception as error:
                        missing['exitCheckError']=str(error)
                report.setdefault('unavailableProcesses',[]).append(missing);continue
            report['processes'].append({**rows[pid],'physicalFootprintBytes':info.phys_footprint,
                'residentBytes':info.resident_size,'kernelLifetimePeakPhysicalFootprintBytes':info.lifetime_max_phys_footprint,
                'processStartAbstime':info.proc_start_abstime,'observerProcess':pid==os.getpid()})
        if not any(row['pid']==root_pid for row in report['processes']):report['error']='root identity not observed by libproc';return report
        report['status']='observed';report['sampledAggregatePhysicalFootprintBytes']=sum(x['physicalFootprintBytes'] for x in report['processes'])
        report['observerIncluded']=True;report['abiSizeBytes']=ctypes.sizeof(RUsageInfoV4)
    except Exception as error:report['error']=str(error)
    return report

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root-pid',type=int,required=True);p.add_argument('--run-id',required=True);a=p.parse_args()
    report=sample_owned_processes(a.root_pid,a.run_id);print(json.dumps(report));sys.exit(0 if report['status']=='observed' else 1)
