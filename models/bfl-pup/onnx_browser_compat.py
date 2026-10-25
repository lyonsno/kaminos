"""Lower recent GenAI fusions to browser-supported ONNX, preserving Q4 tensors.

Gate and norm arithmetic follows canonical Transformers5.20.2 Qwen3.5;
multiaxis RoPE uses the export's exact cosine/sine caches and axis sections.
"""
import argparse
import json
import os
import shutil
import traceback
from pathlib import Path


def browser_compatible(model):
    import numpy as np
    from onnx import helper as h, TensorProto as T, numpy_helper as nh
    nodes=[]
    types={v.name:v.type.tensor_type.elem_type for v in [*model.graph.input,*model.graph.output,*model.graph.value_info]}
    inits={v.name:v for v in model.graph.initializer}
    shared_rope={}
    counts={}
    for original in model.graph.node:
        op=original.op_type
        if original.domain=='com.microsoft' and op in {'CausalConvWithState','LinearAttention'}:
            window=next((a for a in original.attribute if a.name=='state_window'),None)
            if window is not None:
                if window.i!=0:raise ValueError('The browser runtime cannot represent a nonzero state window.')
                original.attribute.remove(window)
        if original.domain!='com.microsoft' or op not in {'LinearAttentionGate','GatedRMSNorm','MRotaryEmbedding'}:
            nodes.append(original);continue
        counts[op]=counts.get(op,0)+1
        prefix=original.name+'/browser'
        attrs={a.name:h.get_attribute_value(a) for a in original.attribute}
        def const(label,value,dtype=np.int64):
            name=prefix+'/'+label
            tensor=nh.from_array(np.array(value,dtype=dtype),name)
            model.graph.initializer.append(tensor)
            return name
        def node(op,inputs,label,**attrs):
            name=prefix+'/'+label
            nodes.append(h.make_node(op,inputs,[name],name=name,**attrs));return name
        def cast(value,dtype,label):return node('Cast',[value],label,to=dtype)
        def finish(value,out):nodes.append(h.make_node('Identity',[value],[out],name=out+'/identity'))
        dtype=types.get(original.output[0],T.FLOAT16)
        if op=='LinearAttentionGate':
            a,bias,scale,b=original.input
            af=cast(a,T.FLOAT,'a-f32')
            added=node('Add',[af,bias],'a-plus-bias')
            soft=node('Softplus',[added],'softplus')
            decay=node('Mul',[soft,scale],'decay')
            finish(cast(decay,dtype,'decay-io'),original.output[0])
            finish(node('Sigmoid',[b],'beta'),original.output[1])
        elif op=='GatedRMSNorm':
            x,weight,z=original.input
            if weight not in inits or len(inits[weight].dims)!=1:raise ValueError('Gated norm requires its per-head source scale.')
            head=int(inits[weight].dims[0])
            shaped=node('Reshape',[x,const('head-shape',[0,0,-1,head])],'heads')
            xf=cast(shaped,T.FLOAT,'x-f32')
            sq=node('Mul',[xf,xf],'square')
            mean=node('ReduceMean',[sq,const('last-axis',[-1])],'mean',keepdims=1)
            var=node('Add',[mean,const('epsilon',attrs.get('epsilon',1e-5),np.float32)],'variance')
            sqrt=node('Sqrt',[var],'sqrt')
            inv=node('Reciprocal',[sqrt],'rsqrt')
            normalized=cast(node('Mul',[xf,inv],'norm-f32'),dtype,'norm-io')
            weighted=node('Mul',[normalized,weight],'weighted')
            flat=node('Reshape',[weighted,node('Shape',[x],'x-shape')],'norm-flat')
            zf=cast(z,T.FLOAT,'gate-f32')
            silu=node('Mul',[zf,node('Sigmoid',[zf],'gate-sigmoid')],'silu')
            out=node('Mul',[cast(flat,T.FLOAT,'weighted-f32'),silu],'gated')
            finish(cast(out,dtype,'output-io'),original.output[0])
        else:
            if attrs.get('interleaved',0)!=0 or attrs.get('mrope_layout')!=1 or attrs.get('is_packed_batching',0)!=0:
                raise ValueError('Only the exact unpacked Qwen3.5 interleaved-axis RoPE layout is admitted.')
            x,pos,cos_cache,sin_cache=original.input
            rotary=int(attrs['rotary_embedding_dim']);half=rotary//2;sections=attrs['mrope_section']
            if sum(sections)!=half:raise ValueError('MRoPE sections do not match rotary dimensions.')
            key=(pos,cos_cache,sin_cache,tuple(sections))
            if key not in shared_rope:
                mask=np.zeros((3,1,1,half),np.float32)
                for i in range(half):
                    axis=i%3
                    if axis and i>=sections[axis]*3:axis=0
                    mask[axis,0,0,i]=1
                mask_name=const('axis-mask',mask,np.float32);axis=const('reduce-axis',[0]);unsqueeze=const('broadcast-axis',[2])
                caches=[]
                for label,cache in [('cos',cos_cache),('sin',sin_cache)]:
                    gathered=node('Gather',[cache,pos],label+'-gather',axis=0)
                    selected=node('Mul',[gathered,mask_name],label+'-select')
                    reduced=node('ReduceSum',[selected,axis],label+'-sum',keepdims=0)
                    caches.append(node('Unsqueeze',[reduced,unsqueeze],label+'-heads'))
                shared_rope[key]=caches
            cos,sin=shared_rope[key]
            shaped=node('Reshape',[x,const('reshape-heads',[0,0,int(attrs['num_heads']),-1])],'x-heads')
            axis=const('slice-axis',[3]);first=node('Slice',[shaped,const('first-start',[0]),const('first-end',[half]),axis],'first')
            second=node('Slice',[shaped,const('second-start',[half]),const('second-end',[rotary]),axis],'second')
            tail=node('Slice',[shaped,const('tail-start',[rotary]),const('tail-end',[2**31-1]),axis],'tail')
            left=node('Sub',[node('Mul',[first,cos],'first-cos'),node('Mul',[second,sin],'second-sin')],'left')
            right=node('Add',[node('Mul',[second,cos],'second-cos'),node('Mul',[first,sin],'first-sin')],'right')
            merged=node('Concat',[left,right,tail],'rotated',axis=3)
            finish(node('Reshape',[merged,node('Shape',[x],'original-shape')],'flatten'),original.output[0])
    del model.graph.node[:];model.graph.node.extend(nodes)
    return counts


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ['package','out','report']:p.add_argument('--'+flag,type=Path,required=True)
    a=p.parse_args();report=dict(status='running',phase='package-validation',source_package=str(a.package),output=str(a.out))
    def save():a.report.parent.mkdir(parents=True,exist_ok=True);a.report.write_text(json.dumps(report,indent=2)+'\n')
    save()
    try:
        import onnx
        if a.out.exists() and any(a.out.iterdir()):raise ValueError('Use a fresh output directory.')
        provenance=json.loads((a.package/'provenance.json').read_text())
        if provenance.get('status')!='complete':raise ValueError('Source package is incomplete.')
        a.out.mkdir(parents=True,exist_ok=True)
        for src in a.package.rglob('*'):
            dst=a.out/src.relative_to(a.package)
            if src.is_dir():dst.mkdir(exist_ok=True)
            elif src.name=='decoder_model_merged_q4f16.onnx':
                report['phase']='lower-decoder';save()
                model=onnx.load(str(src),load_external_data=False)
                report['lowered']=browser_compatible(model)
                dst.write_bytes(model.SerializeToString())
            elif src.name=='preprocessor_config.json':
                from prepare_package import browser_processor_metadata
                config=browser_processor_metadata(json.loads(src.read_text()),json.loads((a.package/'processor_config.json').read_text()))
                dst.write_text(json.dumps(config,indent=2)+'\n')
                report['processor_metadata']='Qwen3VLProcessor in the legacy preprocessor config'
            elif src.name=='provenance.json':continue
            else:os.link(src,dst)
        report.update(status='complete',phase='package-written',claim='lowered graph construction; real browser generation remains to be exercised')
        provenance.update(browser_lowering=report,output=str(a.out))
        (a.out/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n');save()
    except BaseException as error:
        report.update(status='failed',error=str(error),traceback=traceback.format_exc());save();raise

if __name__=='__main__':main()
