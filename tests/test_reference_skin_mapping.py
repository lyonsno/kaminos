import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('reference_skin',Path(__file__).resolve().parents[1]/'tools/reference-skin/prepare.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ReferenceMapping(unittest.TestCase):
    def test_observed_dog_has_foot_at_hock_and_no_horse_link(self):
        names=['Bip01_Pelvis','Bip01_Spine','Bip01_Spine1','Bip01_Spine2','Bip01_Spine3','Bip01_L_Clavicle','Bip01_L_UpperArm','Bip01_L_Calf','Bip01_L_Foot','Bip01_L_Toe0','Bip01_L_Toe01','Bip01_L_Toe02']
        roles=module.aliases(names)
        self.assertEqual(roles['Bip01_L_Foot'],'hindlimb-left-hock')
        self.assertEqual(roles['Bip01_L_Toe02'],'hindlimb-left-toe-end')
        self.assertEqual(roles['Bip01_Spine3'],'spine-chest')
        self.assertEqual(len(set(roles.values())),len(names))
    def test_cat_preserves_separate_horse_link_and_foot(self):
        names=['Bip01_L_HorseLink','Bip01_L_Foot','Bip01_L_Clavicle','Bip01_L_UpperArm']
        roles=module.aliases(names)
        self.assertEqual(roles['Bip01_L_HorseLink'],'hindlimb-left-hock')
        self.assertEqual(roles['Bip01_L_Foot'],'hindlimb-left-foot')
        self.assertNotEqual(roles['Bip01_L_Clavicle'],roles['Bip01_L_UpperArm'])

if __name__=='__main__':unittest.main()
