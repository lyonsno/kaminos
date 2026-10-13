"""Git source status with exactly untracked Finder metadata separated out."""
import subprocess

def git_source_identity(root):
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    raw=subprocess.check_output(['git','status','--porcelain=v1','-z','--untracked-files=all'],cwd=root)
    fields=raw.split(b'\0');kept=[];ignored=[];i=0
    while i<len(fields)-1:
        record=fields[i];i+=1
        if len(record)<4 or record[2:3]!=b' ':raise ValueError('malformed Git source status')
        status,name=record[:2],record[3:]
        if status==b'??' and name.rsplit(b'/',1)[-1]==b'.DS_Store':
            ignored.append(name.decode('utf-8','surrogateescape'));continue
        kept.append(record)
        if b'R' in status or b'C' in status:
            if i>=len(fields)-1:raise ValueError('incomplete renamed Git source status')
            kept.append(fields[i]);i+=1
    return {'commit':commit,'dirty':''.join(value.decode('utf-8','surrogateescape')+'\0' for value in kept),
            'ignoredUntrackedMetadata':ignored,'statusPorcelain':raw.decode('utf-8','surrogateescape')}
