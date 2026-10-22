import importlib.util
import unittest
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location('fields', Path(__file__).parents[1]/'tools/trellis-surfel-fields.py')
fields = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fields)

class RawTriangles(unittest.TestCase):
    def test_selection_preserves_winding_and_source_indices(self):
        faces=np.array([[0,1,2],[2,1,3],[3,4,2]],dtype=np.uint32)
        ids=np.array([1,2,3],dtype=np.uint32)
        selected=fields.selected_triangles(faces,ids,5)
        np.testing.assert_array_equal(selected,[[1,0,2]])
        np.testing.assert_array_equal(fields.selected_triangles(faces,np.arange(5),5),faces)

if __name__=='__main__': unittest.main()
