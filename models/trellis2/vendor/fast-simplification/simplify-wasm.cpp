// fast-simplification 0.2.0 Simplify.h as a single-threaded Wasm module:
// load points/triangles, simplify_mesh(target, agg, verbose=false,
// preserve_border), read back points and triangles. The input buffers are
// owned by this call and freed once loaded, and the vectors are reserved, so a
// multi-million-face surface fits in 32-bit Wasm memory.
#include <stdlib.h>
#include "Simplify.h"
extern "C" {
int fs_simplify(int nv, int nt, double* pts, int* tri, int target, double agg, int preserve_border) {
  using namespace Simplify;
  vertices.clear(); triangles.clear(); refs.clear(); collapses.clear();
  vertices.reserve(nv); triangles.reserve(nt);
  for (int i = 0; i < nv; i++) { Vertex v; v.p.x = pts[3*i]; v.p.y = pts[3*i+1]; v.p.z = pts[3*i+2]; vertices.push_back(v); }
  for (int i = 0; i < nt; i++) { Triangle t; t.attr = 0; t.v[0] = tri[3*i]; t.v[1] = tri[3*i+1]; t.v[2] = tri[3*i+2]; triangles.push_back(t); }
  free(pts); free(tri);
  simplify_mesh(target, agg, false, preserve_border != 0);
  return (int)triangles.size();
}
int fs_points() { return (int)Simplify::vertices.size(); }
void fs_read(double* pts, int* tri) {
  using namespace Simplify;
  for (size_t i = 0; i < vertices.size(); i++) { pts[3*i] = vertices[i].p.x; pts[3*i+1] = vertices[i].p.y; pts[3*i+2] = vertices[i].p.z; }
  for (size_t i = 0; i < triangles.size(); i++) { tri[3*i] = triangles[i].v[0]; tri[3*i+1] = triangles[i].v[1]; tri[3*i+2] = triangles[i].v[2]; }
}
void fs_release() {
  using namespace Simplify;
  std::vector<Vertex>().swap(vertices); std::vector<Triangle>().swap(triangles); std::vector<Ref>().swap(refs);
}
}
