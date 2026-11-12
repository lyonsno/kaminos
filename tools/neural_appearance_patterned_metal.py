"""PatternedMetal's authored MaterialX response, evaluated on portable MLX.

Graph: NVlabs/neuralappearance@305b4b9c, assets/materials/PatternedMetal.mtlx.
BSDF equations: its pinned falcor2@d629c967 mx139 reference implementation,
including the default turquin_analytic compensation, GGX/Fresnel, visible-normal
repair and dielectric layer pass-through. This is a port, not NVIDIA execution.
Native mip0 is point evaluation. Coarser latent grids use the published
Gaussian prefilter of evaluated responses, with native texel-center snapping.
There is no geometry/path-tracing sample budget.
"""
import hashlib,json,math,pathlib
import numpy as np
import mlx.core as mx

NEURAL_SOURCE='305b4b9c12e679398c487603dd8245c3f348526c'
FALCOR_SOURCE='d629c967fa800af81cf5c916bfb2a825b012f473'

def norm(x):return x/mx.maximum(mx.sqrt(mx.sum(x*x,axis=-1,keepdims=True)),1e-20)
def dot(a,b):return mx.sum(a*b,axis=-1)
def cross(a,b):return mx.stack([a[:,1]*b[:,2]-a[:,2]*b[:,1],a[:,2]*b[:,0]-a[:,0]*b[:,2],a[:,0]*b[:,1]-a[:,1]*b[:,0]],axis=-1)

def sample_map(pixels,uv):
 """Native UNORM bytes, periodic bilinear, graph uv_scale=(1,-1)."""
 h,w,_=pixels.shape;p=(uv*mx.array([1.,-1.])-mx.floor(uv*mx.array([1.,-1.])))*mx.array([w,h])-.5
 ij=mx.floor(p).astype(mx.int32);t=p-ij
 def at(dx,dy):return pixels[(ij[:,1]+dy)%h,(ij[:,0]+dx)%w].astype(mx.float32)/255.
 a=at(0,0)*(1-t[:,0:1])+at(1,0)*t[:,0:1];b=at(0,1)*(1-t[:,0:1])+at(1,1)*t[:,0:1]
 return a*(1-t[:,1:2])+b*t[:,1:2]

def artistic_ior(reflectivity):
 r=mx.clip(reflectivity,0.,.99);n=(1-r)/(1+r) # authored edge_color is (1,1,1)
 return n,mx.sqrt(mx.maximum(((n+1)**2*r-(n-1)**2)/(1-r),0.))

def dielectric_fresnel(c,eta=1.3):
 c=mx.clip(c,0.,1.);g=mx.sqrt((eta-1)*(eta+1)+c*c);a=(g-c)/(g+c);b=(c*(g+c)-1)/(c*(g-c)+1)
 return .5*a*a*(1+b*b)

def conductor_fresnel(c,n,k):
 c=mx.clip(c,0.,1.)[:,None];c2=c*c;s2=1-c2;n2=n*n;k2=k*k;t0=n2-k2-s2;ab=mx.sqrt(t0*t0+4*n2*k2)
 t1=ab+c2;t2=2*c*mx.sqrt(mx.maximum(.5*(ab+t0),0.));rs=(t1-t2)/mx.maximum(t1+t2,1e-30);t3=c2*ab+s2*s2;t4=t2*s2
 return .5*mx.clip(rs*(t3-t4)/mx.maximum(t3+t4,1e-30)+rs,0.,2.)

def ggx_energy(view_cos,roughness):
 x=view_cos[:,None];y=roughness[:,None];x2=x*x;y2=y*y
 r=mx.array([.1003,.9345,1.,1.])+mx.array([-.6303,-2.323,-1.765,.2281])*x+mx.array([9.748,2.229,8.263,15.94])*y+mx.array([-2.038,-3.748,11.53,-55.83])*x*y+mx.array([29.34,1.424,28.96,13.08])*x2+mx.array([-8.245,-.7684,-7.507,41.26])*y2+mx.array([-26.44,1.436,-36.11,54.9])*x2*y+mx.array([19.99,.2913,15.86,300.2])*x*y2+mx.array([-5.448,.6286,33.37,-285.1])*x2*y2
 return mx.sum(mx.clip(r[:,:2]/r[:,2:],0.,1.),axis=-1)

def visible_normal(n,wi):
 """falcor2 mx139 bsdl_visible_normal in the unperturbed shading frame."""
 ng=mx.broadcast_to(mx.array([0.,0.,1.]),wi.shape);v=cross(wi,n);vg=cross(wi,ng)
 s=mx.where(wi[:,2]<0,-1.,1.);a=-1/(s+wi[:,2]);fallback=mx.stack([wi[:,0]*wi[:,1]*a,s+wi[:,1]**2*a,-wi[:,1]],axis=-1)
 v=mx.where((mx.max(mx.abs(v),axis=-1)<1e-4)[:,None],mx.where((mx.max(mx.abs(vg),axis=-1)<1e-4)[:,None],fallback,norm(vg)),norm(v))
 return mx.where((dot(wi,n)>0)[:,None],n,norm(cross(v,wi)+1e-4*wi))

def material_response(color,roughness,metallic,normal,wi,wo):
 """Linear RGB already projected on the outgoing/light direction."""
 n=visible_normal(norm(normal),wi);nv=dot(n,wi);nl=dot(n,wo);h=norm(wi+wo);nh=dot(n,h);vh=dot(wi,h)
 # The graph squares artist roughness once. mx139 clamps alpha below1e-4.
 alpha=mx.clip(roughness*roughness,1e-4,2.);a2=alpha*alpha
 den=nh*nh*(a2-1)+1;D=a2/(math.pi*den*den)
 def lam(c):return (mx.sqrt(1+a2*mx.maximum(1-c*c,0)/mx.maximum(c*c,1e-30))-1)*.5
 G=1/(1+lam(nv)+lam(nl));lobe=D*G/(4*mx.maximum(nv,1e-30));E=ggx_energy(mx.abs(nv),mx.sqrt(alpha));missing=(1-E)/mx.maximum(E,1e-6)
 eta,k=artistic_ior(color);Fc=conductor_fresnel(vh,eta,k);Fd=dielectric_fresnel(vh)
 conductor=lobe[:,None]*Fc*(1+Fc*missing[:,None]);dielectric=(lobe*Fd*(1+Fd*missing))[:,None]
 diffuse=color*(mx.maximum(nl,0)*(1-dielectric_fresnel(mx.abs(nv)))/math.pi)[:,None]
 result=(dielectric+diffuse)*(1-metallic[:,None])+conductor*metallic[:,None]
 valid=(wi[:,2]>0)&(wo[:,2]>0)&(nv>0)&(nl>0)
 return mx.where(valid[:,None],mx.maximum(result,0.),0.)

def reference_queries(rng,count,resolution):
 """Fresh square-stratified, center-snapped, uniform Rusinkiewicz queries."""
 side=math.isqrt(count)
 if side*side!=count or type(resolution) is not int or resolution<1:raise ValueError('Square batch and positive latent resolution required')
 cell=np.arange(count);uv=(np.stack([cell%side,cell//side],axis=-1)+rng.random((count,2)))/side
 uv=(np.minimum(resolution-1,np.floor(uv*resolution))+.5)/resolution
 result=np.zeros((count,8),np.float32);result[:,:2]=uv;pending=np.arange(count)
 for _ in range(100): # same validity-attempt bound as the published sampler
  if not len(pending):break
  u=rng.random((len(pending),4));th=u[:,0]*math.pi/2;td=u[:,1]*math.pi/2;ph=u[:,2]*2*math.pi;pd=u[:,3]*2*math.pi
  d=np.stack([np.cos(pd)*np.sin(td),np.sin(pd)*np.sin(td),np.cos(td)],axis=-1)
  r=np.stack([np.cos(th)*d[:,0]+np.sin(th)*d[:,2],d[:,1],-np.sin(th)*d[:,0]+np.cos(th)*d[:,2]],axis=-1)
  wi=np.stack([np.cos(ph)*r[:,0]-np.sin(ph)*r[:,1],np.sin(ph)*r[:,0]+np.cos(ph)*r[:,1],r[:,2]],axis=-1)
  h=np.stack([np.cos(ph)*np.sin(th),np.sin(ph)*np.sin(th),np.cos(th)],axis=-1);wo=2*np.sum(wi*h,axis=-1,keepdims=True)*h-wi;wo/=np.linalg.norm(wo,axis=-1,keepdims=True)
  valid=(wi[:,2]>=1e-3)&(wo[:,2]>=0);result[pending[valid],2:5]=wi[valid];result[pending[valid],5:8]=wo[valid];pending=pending[~valid]
 if len(pending):raise ValueError('Published directional validity attempts exhausted')
 return result

def reference_footprint(resolution):
 """Published filter_sigma(mip_level, native_resolution), one selected mip."""
 if type(resolution) is not int or resolution<1 or resolution>4096 or resolution&(resolution-1):raise ValueError('Power-of-two latent resolution in1..4096 required')
 mip=12-int(math.log2(resolution));sigma=0. if mip==0 else .65*.5*(1<<mip)/4096
 return {'mode':'point' if mip==0 else 'gaussian-response','nativeMapSampling':'bilinear-repeat','nativeResolution':4096,'latentResolution':resolution,'mipLevel':mip,'sigmaUV':sigma,'uvSnap':'latent-texel-center','filteredUvSnap':'native-texel-center','trainingSamples':1 if mip==0 else 64,'referenceSamples':1 if mip==0 else 256}

def filtered_response(evaluate,queries,rng,footprint,reference=False):
 """Port of eval_target_bsdf_lod + sample_2d_gaussian, not parameter filtering.

 Sequential accumulation retains the published sample count without building
 all64/256 samples' BSDF intermediates at once. RNG state remains replayable.
 """
 q=np.asarray(queries,dtype=np.float32)
 if footprint['mipLevel']==0:return evaluate(mx.array(q))
 samples=footprint['referenceSamples' if reference else 'trainingSamples'];total=mx.zeros((len(q),3))
 for _ in range(samples):
  u=rng.random((len(q),2));radius=np.sqrt(-2*np.log(np.maximum(u[:,0],np.finfo(float).tiny)));phi=2*math.pi*u[:,1]
  uv=q[:,:2]+footprint['sigmaUV']*radius[:,None]*np.stack([np.cos(phi),np.sin(phi)],axis=-1)
  sample=q.copy();sample[:,:2]=(np.floor(uv*4096)+.5)/4096
  total=total+evaluate(mx.array(sample));mx.eval(total)
 return total/samples

class PatternedMetal:
 def __init__(self,manifest):
  from PIL import Image
  path=pathlib.Path(manifest).resolve();self.manifest=json.loads(path.read_bytes());m=self.manifest
  if m.get('schema')!='kaminos.patterned-metal-reference.v1' or m.get('neuralSource')!=NEURAL_SOURCE or m.get('falcorSource')!=FALCOR_SOURCE or m.get('response')!='projected-bsdf' or m.get('footprint')!='point-bilinear-native-maps':raise ValueError('Pinned PatternedMetal reference manifest required')
  self.maps={}
  for name,item in m['files'].items():
   p=path.parent/item['path'];data=p.read_bytes()
   if hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Reference source digest changed: '+name)
   if name=='graph':continue
   with Image.open(p) as im:
    if im.mode!='RGBA' or im.size!=(4096,4096):raise ValueError('Authored 4K RGBA8 maps required')
    self.maps[name]=mx.array(np.array(im))
  if set(self.maps)!={'basecolor','normal','roughness','metallic'}:raise ValueError('Complete authored material maps required')
  mx.eval(self.maps);self.evaluate=mx.compile(self._evaluate)
 def _evaluate(self,queries):
  uv=queries[:,:2];color=sample_map(self.maps['basecolor'],uv)[:,:3]**2.2
  normal=sample_map(self.maps['normal'],uv)[:,:3];normal=mx.where((mx.sum(normal*normal,axis=-1)==0)[:,None],mx.array([0.,0.,1.]),normal*2-1)
  roughness=sample_map(self.maps['roughness'],uv)[:,0];metallic=sample_map(self.maps['metallic'],uv)[:,0]
  return material_response(color,roughness,metallic,normal,queries[:,2:5],queries[:,5:8])
