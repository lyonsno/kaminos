// Minimal C ABI over xatlas 0.0.11 for Wasm: one mesh, ChartOptions{maxIterations=0,
// fixWinding=false}, default PackOptions, UVs normalized by atlas size like
// xatlas-python's Atlas.__getitem__. Single-threaded (XA_MULTITHREADED=0).
#include "xatlas.h"
#include <cstdlib>
#include <cstring>
extern "C" {
static xatlas::Atlas* g=nullptr;
// Returns output vertex count, or a negative AddMeshError code.
int xa_unwrap(const float* positions,unsigned vertexCount,const unsigned* indices,unsigned indexCount){
  if(g)xatlas::Destroy(g);g=xatlas::Create();
  xatlas::MeshDecl d;d.vertexCount=vertexCount;d.vertexPositionData=positions;d.vertexPositionStride=12;
  d.indexCount=indexCount;d.indexData=indices;d.indexFormat=xatlas::IndexFormat::UInt32;
  xatlas::AddMeshError e=xatlas::AddMesh(g,d);if(e!=xatlas::AddMeshError::Success)return -1-(int)e;
  xatlas::ChartOptions co;co.maxIterations=0;co.fixWinding=false;xatlas::PackOptions po;
  xatlas::Generate(g,co,po);
  return (int)g->meshes[0].vertexCount;
}
unsigned xa_charts(){return g?g->chartCount:0;}
unsigned xa_width(){return g?g->width:0;}
unsigned xa_height(){return g?g->height:0;}
unsigned xa_index_count(){return g?g->meshes[0].indexCount:0;}
void xa_read(float* uv,unsigned* xref,unsigned* indices){
  const xatlas::Mesh&m=g->meshes[0];
  for(unsigned v=0;v<m.vertexCount;v++){xref[v]=m.vertexArray[v].xref;uv[v*2]=m.vertexArray[v].uv[0]/g->width;uv[v*2+1]=m.vertexArray[v].uv[1]/g->height;}
  memcpy(indices,m.indexArray,m.indexCount*4);
}
void xa_release(){if(g)xatlas::Destroy(g);g=nullptr;}
}
