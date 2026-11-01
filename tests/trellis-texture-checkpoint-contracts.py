# kaminos-test: python
"""Pipeline selection follows official TRELLIS run's 512/1024 texture roles."""
import ast
import types
import sys
import json
import importlib.util
from pathlib import Path
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'models/trellis2/pack-generation.py'
sys.path.insert(0,str(SCRIPT.parent))
spec=importlib.util.spec_from_file_location('pack',SCRIPT)
pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)

def actual_selection(profile):
    tree=ast.parse(SCRIPT.read_text())
    loop=next(n for n in ast.walk(tree) if isinstance(n,ast.For) and ast.unparse(n.target)=='(role, stem, res, sampler)')
    return eval(compile(ast.Expression(loop.iter),str(SCRIPT),'eval'),{**vars(pack),'a':types.SimpleNamespace(pipeline_type=profile)})

class TextureCheckpoint(unittest.TestCase):
    def test_cascade_uses_1024_texture_and_hr_shape(self):
        specs=actual_selection('1024_cascade')
        self.assertIn(('textureFlow','slat_flow_imgshape2tex_dit_1_3B_1024_bf16',64,'tex_slat_sampler'),specs)
        self.assertEqual(len(specs),2)
    def test_512_uses_512_texture_without_hr_shape(self):
        self.assertEqual(actual_selection('512'),[('textureFlow','slat_flow_imgshape2tex_dit_1_3B_512_bf16',32,'tex_slat_sampler')])
    def test_selected_roles_match_observed_official_pipeline_and_config(self):
        fixture=json.loads((SCRIPT.parent/'tests/fixtures/texture-checkpoints.json').read_text())['files']
        source=fixture['pipeline.json']['content']['args']['models']
        for profile,size in [('512',512),('1024_cascade',1024)]:
            role,stem,res,sampler=actual_selection(profile)[-1]
            self.assertEqual(source[f'tex_slat_flow_model_{size}'],'ckpts/'+stem)
            self.assertEqual(fixture['ckpts/'+stem+'.json']['content']['args']['resolution'],res)

    def test_unknown_pipeline_rejects(self):
        with self.assertRaises(ValueError):actual_selection('2048')

class PreparedReuse(unittest.TestCase):
    def test_preparation_cannot_relabel_texture_weights(self):
        from checkpoint_profiles import require_texture_checkpoint
        for profile,size in [('512',512),('1024_cascade',1024)]:
            manifest={'models':{'textureFlow':{'identity':{'path':f'/ckpts/slat_flow_imgshape2tex_dit_1_3B_{size}_bf16.safetensors'}}}}
            require_texture_checkpoint(manifest,profile)
            with self.assertRaisesRegex(ValueError,'image preparation cannot replace model weights'):
                require_texture_checkpoint(manifest,'512' if size==1024 else '1024_cascade')
        with self.assertRaises(ValueError):require_texture_checkpoint({},'512')

if __name__=='__main__':unittest.main()
