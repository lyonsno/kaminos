import {conditioningSettings,CONDITIONING_ROUTE} from './image-conditioning.mjs';
// Offscreen image operator; it does not own a scene camera or app frame loop.
const vertex=`#version 300 es
precision highp float;
layout(location=0) in vec3 position;
layout(location=1) in vec3 color;
layout(location=2) in vec3 normal;
layout(location=3) in float coverage;
uniform vec2 raster;
uniform vec2 grid;
uniform float sourceHeight;
uniform float aspect;
uniform float boundary;
uniform float clay;
uniform float contrast;
uniform float density;
out vec2 gaussian;
out vec3 pigment;
out float mass;
void main(){
 vec2 corners[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(-1,1),vec2(-1,1),vec2(1,-1),vec2(1,1));
 vec2 corner=corners[gl_VertexID];
 if(coverage<=0.0){gl_Position=vec4(2,2,0,1);gaussian=vec2(0);pigment=vec3(0);mass=0.0;return;}
 float z=max(position.z,0.000001);
 float sigma=(0.55*raster.y/grid.y+boundary*raster.y/sourceHeight)/z;
 vec2 center=vec2(position.x/z/aspect,-position.y/z)*2.0;
 gl_Position=vec4(center+corner*4.0*sigma*2.0/raster,0,1);
 gaussian=corner*4.0;
 float shade=0.35+0.65*max(0.0,dot(normal/max(length(normal),0.000001),normalize(vec3(-0.4,-0.5,-0.8))));
 pigment=clamp((mix(color,vec3(0.65)*shade,clay)-0.5)*contrast+0.5,0.0,1.0);
 mass=coverage*density*(raster.x/grid.x)*(raster.y/grid.y)/(6.28318530718*sigma*sigma);
}`;
const accumulate=`#version 300 es
precision highp float;
in vec2 gaussian;
in vec3 pigment;
in float mass;
out vec4 result;
void main(){float tau=mass*exp(-0.5*dot(gaussian,gaussian));result=vec4(pigment*tau,tau);}`;
const screen=`#version 300 es
precision highp float;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const resolve=`#version 300 es
precision highp float;
uniform sampler2D accumulation;
uniform vec3 background;
out vec4 result;
void main(){vec4 sum=texelFetch(accumulation,ivec2(gl_FragCoord.xy),0);float alpha=1.0-exp(-sum.a);result=vec4(mix(background,sum.rgb/max(sum.a,0.0000001),alpha),1);}`;
export function createConditioningRenderer(canvas){
 const gl=canvas.getContext('webgl2',{alpha:false,preserveDrawingBuffer:true,antialias:false});if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Conditioning preview needs WebGL2 float accumulation');
 const programs=[],buffers=[],textures=[],frames=[],vaos=[];
 function program(v,f){const shaders=[];try{const compile=(type,source)=>{const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};const p=gl.createProgram();programs.push(p);gl.attachShader(p,compile(gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,f));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;}finally{shaders.forEach(s=>gl.deleteShader(s));}}
 const draw=program(vertex,accumulate),finish=program(screen,resolve),vao=gl.createVertexArray();vaos.push(vao);gl.bindVertexArray(vao);
 for(let i=0;i<4;i++){const b=gl.createBuffer();buffers.push(b);gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,i===3?1:3,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(i,1);}
 const texture=gl.createTexture(),frame=gl.createFramebuffer();textures.push(texture);frames.push(frame);let size='',cloud=null;
 const uniform=(p,n)=>gl.getUniformLocation(p,n);
 return {
  route:CONDITIONING_ROUTE,
  setCloud(value){cloud=value;for(const [i,key]of ['positions','colors','normals','alpha'].entries()){gl.bindBuffer(gl.ARRAY_BUFFER,buffers[i]);gl.bufferData(gl.ARRAY_BUFFER,value[key],gl.STATIC_DRAW);}},
  render(settings,{width=canvas.width,height=canvas.height}={}){
   if(gl.isContextLost())throw Error('Conditioning preview context is lost');if(!cloud)throw Error('Load conditioning geometry first');const p=conditioningSettings(settings);if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>gl.getParameter(gl.MAX_TEXTURE_SIZE))throw Error('Unsupported conditioning raster');
   canvas.width=width;canvas.height=height;gl.viewport(0,0,width,height);
   gl.bindTexture(gl.TEXTURE_2D,texture);if(size!==`${width}:${height}`){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA,gl.HALF_FLOAT,null);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);size=`${width}:${height}`;}
   gl.bindFramebuffer(gl.FRAMEBUFFER,frame);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Float accumulation framebuffer unavailable');
   gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.useProgram(draw);gl.bindVertexArray(vao);
   gl.uniform2f(uniform(draw,'raster'),width,height);gl.uniform2f(uniform(draw,'grid'),cloud.width,cloud.height);gl.uniform1f(uniform(draw,'aspect'),cloud.aspect);gl.uniform1f(uniform(draw,'sourceHeight'),cloud.sourceHeight);for(const key of ['boundary','clay','contrast','density'])gl.uniform1f(uniform(draw,key),p[key]);gl.drawArraysInstanced(gl.TRIANGLES,0,6,cloud.alpha.length);
   gl.disable(gl.BLEND);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(finish);gl.bindVertexArray(null);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(uniform(finish,'accumulation'),0);gl.uniform3fv(uniform(finish,'background'),p.background);gl.drawArrays(gl.TRIANGLES,0,3);
   const error=gl.getError();if(error!==gl.NO_ERROR)throw Error(`Conditioning render GL error ${error}`);return {route:CONDITIONING_ROUTE,width,height,points:cloud.alpha.length,settings:p};
  },
  pixels(){const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;},
  dispose(){programs.forEach(x=>gl.deleteProgram(x));buffers.forEach(x=>gl.deleteBuffer(x));textures.forEach(x=>gl.deleteTexture(x));frames.forEach(x=>gl.deleteFramebuffer(x));vaos.forEach(x=>gl.deleteVertexArray(x));}
 };
}
