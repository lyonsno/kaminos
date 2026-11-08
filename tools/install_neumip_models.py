#!/usr/bin/env python3
"""Install author NeuMIP web checkpoints locally; retain provenance, no GPU work."""
import argparse, hashlib, json, os, tempfile, urllib.request
from pathlib import Path

NAMES = ('cave','cliff','dotted','embroidery','foam','rocky','sbai','shell','victorian','wool','wool2')
BASE = 'https://cseweb.ucsd.edu/~viscomp/projects/NeuMIP/demo/assets/neuralmat/'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',required=True,type=Path)
    parser.add_argument('--materials',nargs='+',choices=NAMES,default=['wool2','rocky','embroidery'])
    parser.add_argument('--source-dir',type=Path,help='Reuse previously downloaded author archives')
    args=parser.parse_args();args.root.mkdir(parents=True,exist_ok=True)
    path=args.root/'catalog.json';catalog=json.loads(path.read_text()) if path.exists() else {'schema':'kaminos.neumip.author-models.v1','materials':{}}
    for name in args.materials:
        filename=name+'_web.model';target=args.root/filename;url=BASE+filename
        source=args.source_dir/filename if args.source_dir else target
        data=source.read_bytes() if source.is_file() else urllib.request.urlopen(url).read()
        if len(data)!=17489293 or data[0]!=1:raise ValueError(f'Unexpected author archive: {name}')
        digest=hashlib.sha256(data).hexdigest()
        with tempfile.NamedTemporaryFile(dir=args.root,delete=False) as output:
            output.write(data);temporary=output.name
        os.replace(temporary,target)
        catalog['materials'][name]={'name':name,'filename':filename,'source':url,'sha256':digest,'bytes':len(data)}
        print(name,digest,len(data),flush=True)
    with tempfile.NamedTemporaryFile(mode='w',dir=args.root,delete=False) as output:
        json.dump(catalog,output,indent=2);temporary=output.name
    os.replace(temporary,path)
    print(path)

if __name__=='__main__':main()
