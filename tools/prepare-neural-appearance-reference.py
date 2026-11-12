#!/usr/bin/env python3
"""Copy the pinned author material without changing texture bytes or graph."""
import argparse,hashlib,json,pathlib,subprocess

def author_bytes_match(data,committed):
 if data==committed:return True
 if not committed.startswith(b'version https://git-lfs.github.com/spec/v1\n'):return False
 fields=dict(line.split(b' ',1) for line in committed.splitlines())
 return fields.get(b'oid')==b'sha256:'+hashlib.sha256(data).hexdigest().encode() and fields.get(b'size')==str(len(data)).encode()

def prepare(source,output):
 source=pathlib.Path(source).resolve();output=pathlib.Path(output).resolve();output.mkdir(parents=True,exist_ok=True)
 commit=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
 if commit!='305b4b9c12e679398c487603dd8245c3f348526c':raise ValueError('Pinned NVIDIA source revision required')
 result={'schema':'kaminos.patterned-metal-reference.v1','neuralSource':commit,'falcorSource':'d629c967fa800af81cf5c916bfb2a825b012f473','material':'PatternedMetal','response':'projected-bsdf','footprint':'point-bilinear-native-maps','license':'CC0-1.0','files':{},'port':'MaterialX graph and pinned falcor2 mx139 default turquin_analytic equations; not execution of NVIDIA Falcor backend'}
 for name in ['graph','basecolor','normal','roughness','metallic']:
  filename='PatternedMetal.mtlx' if name=='graph' else 'PatternedMetal_'+name+'.png';relative='assets/materials/'+filename;data=(source/relative).read_bytes()
  if not author_bytes_match(data,subprocess.check_output(['git','-C',str(source),'show',commit+':'+relative])):raise ValueError('Source bytes differ from committed author asset: '+name)
  target=output/filename
  if target.exists() and target.read_bytes()!=data:raise ValueError('Existing source package differs; choose a new output directory')
  target.write_bytes(data);result['files'][name]={'path':filename,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
 payload=(json.dumps(result,indent=2)+'\n').encode();(output/'reference.model').write_bytes(payload)
 return {'path':str(output/'reference.model'),'sha256':hashlib.sha256(payload).hexdigest()}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');a=p.parse_args();print(json.dumps(prepare(a.source,a.output)))
