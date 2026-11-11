# kaminos-test: manual — NumPy environment, source geometry only
import importlib.util,unittest
from pathlib import Path
import numpy as np
s=importlib.util.spec_from_file_location('regions',Path(__file__).parents[1]/'tools/trellis-raw-regions.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Regions(unittest.TestCase):
 def test_crossing_triangle_keeps_vertices_outside_volume_and_exact_material_rows(self):
  d=np.zeros((6,12),dtype=np.float32);d[:,:3]=[[-2,0,-2],[2,0,-2],[0,0,2],[4,0,4],[5,0,4],[4,0,5]];d[:,6]=np.arange(6)
  a,t,v,ids=m.select(d,np.array([[0,1,2],[3,4,5]],dtype=np.uint32),{'origin':[0,0,0],'normal':[0,1,0],'tangent':[1,0,0],'radius':.5,'depth':.1,'top':.1})
  np.testing.assert_array_equal(ids,[0]);np.testing.assert_array_equal(v,[0,1,2]);np.testing.assert_array_equal(t,[[0,1,2]]);np.testing.assert_array_equal(a,d[:3])
if __name__=='__main__':unittest.main()
