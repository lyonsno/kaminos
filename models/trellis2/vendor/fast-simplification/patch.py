"""Write the Kaminos Wasm variant of fast-simplification's Simplify.h: explicit
FMA at the native arm64 contraction sites (as the browser JS port), no
collapse history. Every replacement must match exactly once (or as stated)."""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (old[:60], n)
    s = s.replace(old, new)

rep('#include <float.h> //FLT_EPSILON, DBL_EPSILON', '''#include <float.h> //FLT_EPSILON, DBL_EPSILON
#include <wasm_simd128.h>
#include <emscripten.h>
// Progress: the loop reports each iteration (remaining faces) to Module.onIteration.
EM_JS(void, fs_on_iteration, (int iteration, int faces), { if (Module.onIteration) Module.onIteration(iteration, faces); });
// Kaminos Wasm build: compiled with -ffp-contract=off; the multiply-adds that
// the native arm64 build contracts are written as fused multiply-adds through
// relaxed SIMD (a true FMA where the runtime fuses; the caller probes this).
static inline double FMA(double a, double b, double c) {
  return wasm_f64x2_extract_lane(wasm_f64x2_relaxed_madd(wasm_f64x2_splat(a), wasm_f64x2_splat(b), wasm_f64x2_splat(c)), 0);
}''')
rep('return (double)sqrt(x*x + y*y + z*z);', 'return (double)sqrt(FMA(z,z,FMA(x,x,y*y)));')
rep('double square = sqrt(x*x + y*y + z*z);', 'double square = sqrt(FMA(z,z,FMA(x,x,y*y)));')
rep('{ return a.x*x + a.y*y + a.z*z; }', '{ return FMA(a.z,z,FMA(a.x,x,a.y*y)); }')
rep('''		x = a.y * b.z - a.z * b.y;
		y = a.z * b.x - a.x * b.z;
		z = a.x * b.y - a.y * b.x;''', '''		x = FMA(a.y, b.z, -(a.z * b.y));
		y = FMA(a.z, b.x, -(a.x * b.z));
		z = FMA(a.x, b.y, -(a.y * b.x));''')
rep('''		double det =  m[a11]*m[a22]*m[a33] + m[a13]*m[a21]*m[a32] + m[a12]*m[a23]*m[a31]
					- m[a13]*m[a22]*m[a31] - m[a11]*m[a23]*m[a32]- m[a12]*m[a21]*m[a33];''', '''		double det = FMA(m[a11]*m[a22], m[a33], m[a13]*m[a21]*m[a32]);
		det = FMA(m[a12]*m[a23], m[a31], det);
		det = FMA(-(m[a13]*m[a22]), m[a31], det);
		det = FMA(-(m[a11]*m[a23]), m[a32], det);
		det = FMA(-(m[a12]*m[a21]), m[a33], det);''')
rep('''		return   q[0]*x*x + 2*q[1]*x*y + 2*q[2]*x*z + 2*q[3]*x + q[4]*y*y
 		     + 2*q[5]*y*z + 2*q[6]*y + q[7]*z*z + 2*q[8]*z + q[9];''', '''		double e = FMA(q[0]*x, x, 2*q[1]*x*y);
		e = FMA(2*q[2]*x, z, e); e = FMA(2*q[3], x, e); e = FMA(q[4]*y, y, e);
		e = FMA(2*q[5]*y, z, e); e = FMA(2*q[6], y, e); e = FMA(q[7]*z, z, e);
		e = FMA(2*q[8], z, e);
		return e + q[9];''')
rep('''			if(triangle_count-deleted_triangles<=target_count)break;

			// update mesh once in a while''', '''			if(triangle_count-deleted_triangles<=target_count)break;
			fs_on_iteration(iteration, triangle_count-deleted_triangles);

			// update mesh once in a while''')
rep('collapses.push_back(std::vector<int>({i0,i1}));', '/* collapse history not recorded in the Kaminos build */', 2)
# Memory: the texture-coordinate and material fields (never set: attr is 0, so
# update_uvs never runs) and the OBJ reader/writer are compiled out, shrinking
# a triangle from 168 to 88 bytes so multi-million-face surfaces fit in 32-bit
# Wasm memory. Arithmetic is untouched.
rep('struct Triangle { int v[3];double err[4];int deleted,dirty,attr;vec3f n;vec3f uvs[3];int material; };',
    'struct Triangle { int v[3];double err[4];int deleted,dirty,attr;vec3f n; };')
rep('''			vec3f p1=vertices[t.v[0]].p;
			vec3f p2=vertices[t.v[1]].p;
			vec3f p3=vertices[t.v[2]].p;
			t.uvs[r.tvertex] = interpolate(p,p1,p2,p3,t.uvs);''', '''			/* texture coordinates are not carried in the Kaminos build */''')
a = s.index('	//Option : Load OBJ')
b = s.index('};\n///////////////////////////////////////////', a)
s = s[:a] + '\t/* OBJ reader and writer not compiled in the Kaminos build */\n' + s[b:]
open(dst, 'w').write(s)
