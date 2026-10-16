# kaminos-test: python
import copy
import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from transfer_paw_skin import PAWS,transfer_weights


class PawSkinTransferTests(unittest.TestCase):
    def setUp(self):
        names=['pelvis']+sorted(PAWS)+['body-'+str(i) for i in range(23)]
        bones=[{'name':n,'parent':None if n=='pelvis' else 'pelvis','restMatrix':np.eye(4).tolist()} for n in names]
        self.old={'bones':bones,'channels':['fixed']+names,'vertices':3}
        self.frame={'bones':copy.deepcopy(bones)}
        for n in sorted(PAWS):
            b=next(b for b in self.frame['bones'] if b['name']==n);b['restMatrix'][0][3]=.2
            self.frame['bones'].append({'name':n+'-end','parent':n,'restMatrix':np.eye(4).tolist()})
        self.weights=np.zeros((3,29),dtype='<f4');self.weights[:,1]=.25;self.weights[:,2]=.75

    def test_every_old_influence_is_exact_and_endpoints_unweighted(self):
        before=copy.deepcopy((self.old,self.frame,self.weights))
        weights,names=transfer_weights(self.old,self.frame,self.weights)
        self.assertEqual(weights.shape,(3,33))
        for i,n in enumerate(self.old['channels']):np.testing.assert_array_equal(weights[:,names.index(n)],self.weights[:,i])
        for n in PAWS:np.testing.assert_array_equal(weights[:,names.index(n+'-end')],0)
        self.assertEqual(before[:2],(self.old,self.frame));np.testing.assert_array_equal(before[2],self.weights)

    def test_nonpaw_change_refused(self):
        self.frame['bones'][0]['restMatrix'][1][3]=1
        with self.assertRaisesRegex(ValueError,'non-paw'):transfer_weights(self.old,self.frame,self.weights)

    def test_wrong_endpoint_parent_refused(self):
        self.frame['bones'][-1]['parent']='pelvis'
        with self.assertRaisesRegex(ValueError,'terminal'):transfer_weights(self.old,self.frame,self.weights)

    def test_retyped_inventory_refused(self):
        self.frame['bones'][-1]['name']='surprise'
        with self.assertRaisesRegex(ValueError,'intervention'):transfer_weights(self.old,self.frame,self.weights)

    def test_invalid_partition_refused(self):
        self.weights[0,0]=-.1
        with self.assertRaisesRegex(ValueError,'influences'):transfer_weights(self.old,self.frame,self.weights)
