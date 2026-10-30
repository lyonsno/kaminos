"""The inherited similarity law is unchanged; concrete acceptance, not a new fix."""
import ast
from pathlib import Path
import numpy as np
source=ast.parse(Path(__file__).with_name('register.py').read_text())
functions=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name=='umeyama']
namespace={'np':np};exec(compile(ast.Module(body=functions,type_ignores=[]),'registration-law','exec'),namespace)
X=np.array([[0.,0.,0.],[1.,0.,0.],[0.,2.,0.],[0.,0.,3.],[1.,2.,3.]])
R=np.array([[0.,-1.,0.],[1.,0.,0.],[0.,0.,1.]])
Y=2.5*(X@R.T)+np.array([4.,-3.,2.])
s,rotation,t=namespace['umeyama'](X,Y)
np.testing.assert_allclose(s,2.5,atol=1e-12);np.testing.assert_allclose(rotation,R,atol=1e-12);np.testing.assert_allclose(t,[4,-3,2],atol=1e-12)
assert np.linalg.det(rotation)>0
np.testing.assert_allclose((s*(rotation@X.T)).T+t,Y,atol=1e-12)
np.testing.assert_array_equal(X,np.array([[0.,0.,0.],[1.,0.,0.],[0.,2.,0.],[0.,0.,3.],[1.,2.,3.]]))
print('inherited fit law: exact similarity recovered, proper rotation, source unchanged; already passing law retained')
