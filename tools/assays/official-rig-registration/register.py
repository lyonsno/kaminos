import bpy, math, mathutils, sys, json, re, hashlib, numpy as np
from pathlib import Path
from mathutils.kdtree import KDTree
argv=sys.argv[sys.argv.index('--')+1:]; glb,OUT,tag,rig_id,restp,fracp=argv
Path(OUT).mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(0)
source_receipt={'glbSha256':hashlib.sha256(Path(glb).read_bytes()).hexdigest(),'restSha256':hashlib.sha256(Path(restp).read_bytes()).hexdigest(),'radiiSha256':hashlib.sha256(Path(fracp).read_bytes()).hexdigest(),'fit':'legacy official-rig capsule similarity fit; provisional volume prior','sampling':{'fitVertices':6000,'surfaceQuery':'all vertices'},'admission':'unreviewed candidate orientations; lower Chamfer does not prove anatomy'}
D=json.load(open(restp)); F=json.load(open(fracp))['f']
rig=[r for r in D['rigs'] if r['id']==rig_id][0]; names=rig['names']; par=rig['parents']; pos=rig['positions']; s_rig=rig['trunkLength']
EXCL=re.compile(r'Mouth|BN_Ear|Beard|Thouge|Jaw|Ponytail|Eyes|Eyeled|Tunge',re.I)
def role(n):
    if n in('pelvis','Bip01_Pelvis'): return F['pelvis']
    if n in('spine-lumbar','Bip01_Spine','Bip01_Spine1'): return F['spine-lumbar']
    if n in('spine-chest','Bip01_Spine2','Bip01_Spine3'): return F['spine-chest']
    if 'Neck' in n or n=='neck': return F['neck']
    if n in('head','Bip01_Head'): return F['head']
    if n in('head-end','Bip01_HeadNub','Bip01_Head_Muzzle'): return F['head-end']
    if n.endswith('hip') or 'Thigh' in n: return F['hip']
    if n.endswith('stifle') or 'Calf' in n: return F['stifle']
    if n.endswith('hock') or 'HorseLink' in n: return F['hock']
    if 'Foot' in n: return F['hock'] if rig_id=='dog' else F['hind-toe']
    if n.endswith('shoulder') or 'Clavicle' in n or 'UpperArm' in n: return F['shoulder']
    if n.endswith('elbow') or 'Forearm' in n: return F['elbow']
    if n.endswith('wrist') or 'Hand' in n: return F['wrist']
    if n.endswith('-mtp'): return F['mtp']
    if n.endswith('-toe-tip'): return F['toe-tip']
    if n.endswith('-toe'): return F['hind-toe']
    if re.search(r'Toe0$|Finger0$',n): return F['mtp']
    if re.search(r'Toe0\d|Toe0Nub|Finger0\d|Finger0Nub',n): return F['toe-tip']
    m=re.search(r'(?:tail-|Tail_0|Tail)(\d)',n)
    if m: return F['tail'][min(int(m.group(1))-(1 if ('Tail_0' in n or n.startswith('tail-')) else 0),5)]
    if 'Tail' in n: return F['tail'][0]
    raise KeyError(n)
keep=[i for i,n in enumerate(names) if not EXCL.search(n)]
P={i:np.array([pos[i][0],-pos[i][2],pos[i][1]]) for i in keep}; R={i:role(names[i])*s_rig for i in keep}
pts=[]
for i in keep:
    p=par[i]
    if p<0 or p not in P: continue
    a,b=P[p],P[i]; d=b-a; L=np.linalg.norm(d)
    if L<1e-9: continue
    u=d/L; t=np.cross(u,[0,0,1] if abs(u[2])<0.9 else [1,0,0]); t/=np.linalg.norm(t); w=np.cross(u,t)
    for sv in np.linspace(0,1,max(3,int(L/(0.02*s_rig)))):
        r=R[p]*(1-sv)+R[i]*sv
        for th in np.linspace(0,2*np.pi,12,endpoint=False): pts.append(a+d*sv+r*(np.cos(th)*t+np.sin(th)*w))
M=np.array(pts); M=M[rng.choice(len(M),min(6000,len(M)),replace=False)]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
ms=[o for o in bpy.context.scene.objects if o.type=='MESH']
V=np.array([list(o.matrix_world@v.co) for o in ms for v in o.data.vertices]); C=V[rng.choice(len(V),min(6000,len(V)),replace=False)]
def nn(A,B):
    tree=KDTree(len(B))
    for j,p in enumerate(B):tree.insert(p,j)
    tree.balance();idx=np.empty(len(A),int);dist=np.empty(len(A))
    for j,p in enumerate(A):_,idx[j],dist[j]=tree.find(p)
    return idx,dist
def umeyama(X,Y):
    mx,my=X.mean(0),Y.mean(0); Xc,Yc=X-mx,Y-my; Sm=Yc.T@Xc/len(X); U,Dg,Vt=np.linalg.svd(Sm); E=np.eye(3)
    if np.linalg.det(U@Vt)<0: E[2,2]=-1
    Rm=U@E@Vt; sc=np.trace(np.diag(Dg)@E)/((Xc**2).sum()/len(X)); return sc,Rm,my-sc*Rm@mx
def pca(X):
    c=X.mean(0); _,_,vt=np.linalg.svd(X-c,full_matrices=False); return c,vt
cc,cv=pca(C); mc,mv=pca(M); JP=np.array([P[i] for i in keep])
def ext(X,ax): return np.percentile(X[:,ax],99)-np.percentile(X[:,ax],1)
best=None
candidates=[]
for sx in(1,-1):
  for sy in(1,-1):
    sz=sx*sy*np.sign(np.linalg.det(cv))*np.sign(np.linalg.det(mv)); Rm=mv.T@np.diag([sx,sy,sz])@cv
    sc=np.sqrt(((M-mc)**2).sum(1).mean()/((C-cc)**2).sum(1).mean()); t=mc-sc*Rm@cc
    for it in range(40):
        X=(sc*(Rm@C.T)).T+t; idx,_=nn(X,M); sc,Rm,t=umeyama(C,M[idx])
    for rep in range(3):
        X=(sc*(Rm@C.T)).T+t; sc*=np.mean([ext(JP,1)/ext(X,1),ext(JP,2)/ext(X,2)])
        for it in range(30):
            Xs=(sc*(Rm@C.T)).T; X=Xs+t; idx,_=nn(X,M); Y=M[idx]; mx,my=Xs.mean(0),Y.mean(0); H=(Y-my).T@(Xs-mx); U,Dg,Vt=np.linalg.svd(H); E=np.eye(3)
            if np.linalg.det(U@Vt)<0: E[2,2]=-1
            Rd=U@E@Vt; Rm=Rd@Rm; t=my-Rd@mx
    X=(sc*(Rm@C.T)).T+t; _,d1=nn(X,M); _,d2=nn(M,X); ch=float(d1.mean()+d2.mean())
    candidates.append({'index':len(candidates),'chamfer_over_trunk':ch/s_rig,'scale':float(sc),'rotation':Rm.tolist(),'translation':t.tolist(),'pca_signs':[int(sx),int(sy)]})
    if best is None or ch<best[0]: best=(ch,sc,Rm,t,(sx,sy))
ch,sc,Rm,t,sg=best
X=(sc*(Rm@V.T)).T+t; _,dj=nn(JP,X)
per={names[i]:round(float(dj[k]/max(R[i],0.015*s_rig)),2) for k,i in enumerate(keep)}
json.dump({'source':source_receipt,'rig':rig_id,'candidates':candidates,'lowest_geometric_residual':int(min(candidates,key=lambda c:c['chamfer_over_trunk'])['index']),'unchangedRig':rig,'lowest_residual_joint_distance_over_provisional_radius':per,'warning':'Joint distance to surface is not containment or correspondence. No candidate is semantically admitted yet.'},open(f'{OUT}/{tag}-registration.json','w'),indent=2)
# Keep all four rigid orientation hypotheses inspectable; no corrective warp.
original_matrices={o.name:o.matrix_world.copy() for o in ms}
bodymat=bpy.data.materials.new('cast clay');bodymat.diffuse_color=(.30,.48,.58,1);bodymat.use_nodes=True
bodymat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.30,.48,.58,1)
bodymat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8
red=bpy.data.materials.new('rig orange');red.diffuse_color=(1,.18,.02,1);red.use_nodes=True
red.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(1,.18,.02,1)
rig_objects=[]
for i in keep:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.015*s_rig,location=P[i]);o=bpy.context.object;o.name='rig joint '+names[i];o.data.materials.append(red);rig_objects.append(o)
    p=par[i]
    if p<0 or p not in P:continue
    a,b=mathutils.Vector(P[p]),mathutils.Vector(P[i]);d=b-a
    if d.length:
        bpy.ops.mesh.primitive_cylinder_add(vertices=8,radius=.006*s_rig,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name='rig bone '+names[i];o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(red);rig_objects.append(o)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8;scene.cycles.device='CPU';scene.render.resolution_x=scene.render.resolution_y=512;scene.render.resolution_percentage=100
scene.view_settings.view_transform='Standard'
w=bpy.data.worlds.new('studio');scene.world=w;w.use_nodes=True;w.node_tree.nodes['Background'].inputs[0].default_value=(.65,.65,.65,1);w.node_tree.nodes['Background'].inputs[1].default_value=.8
ld=bpy.data.lights.new('key','AREA');ld.energy=250;ld.shape='DISK';ld.size=3;light=bpy.data.objects.new('key',ld);scene.collection.objects.link(light);light.location=(2,-3,4)
cam=bpy.data.cameras.new('camera');co=bpy.data.objects.new('camera',cam);scene.collection.objects.link(co);scene.camera=co;cam.type='ORTHO'
rigpts=np.array(list(P.values()));center=mathutils.Vector((rigpts.min(0)+rigpts.max(0))/2);size=float((rigpts.max(0)-rigpts.min(0)).max());cam.ortho_scale=size*1.35
for c in candidates:
    sc=c['scale'];Rm=np.array(c['rotation']);t=np.array(c['translation']);T=mathutils.Matrix([[*(sc*Rm[k]).tolist(),t[k]] for k in range(3)]+[[0,0,0,1]])
    for o in ms:o.matrix_world=T@original_matrices[o.name]
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms:o.select_set(True)
    bpy.context.view_layer.objects.active=ms[0]
    bpy.ops.export_scene.gltf(filepath=f'{OUT}/{tag}-candidate{c["index"]}.glb',export_format='GLB',use_selection=True)
    # Body and unchanged rig render separately at the same camera for projected overlay.
    for o in rig_objects:o.hide_render=True
    for k,direction in enumerate([(1,-.42,.24),(-1,.35,.18)]):
        d=mathutils.Vector(direction).normalized();co.location=center+d*size*3;co.rotation_euler=(center-co.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=f'{OUT}/{tag}-candidate{c["index"]}-view{k}.png';bpy.ops.render.render(write_still=True)
    # The separate skeleton-only render uses identical camera and framing.
    for o in ms:o.hide_render=True
    for o in rig_objects:o.hide_render=False
    co.location=center+mathutils.Vector((1,-.42,.24)).normalized()*size*3;co.rotation_euler=(center-co.location).to_track_quat('-Z','Y').to_euler()
    scene.render.film_transparent=True;scene.render.filepath=f'{OUT}/{tag}-candidate{c["index"]}-rig.png';bpy.ops.render.render(write_still=True);scene.render.film_transparent=False
    for o in ms:o.hide_render=False
print('Registration candidates preserved:',tag,len(candidates))
