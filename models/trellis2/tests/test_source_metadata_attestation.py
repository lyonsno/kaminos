# kaminos-test: python
"""Real Git status fixtures; no preprocessing/model execution or guard stand-in."""
import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

MODEL=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(MODEL))

def production_identity(root):
    tree=ast.parse((MODEL/'prepare-foreground.py').read_text())
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='ident')
    namespace={'subprocess':subprocess}
    if (MODEL/'source_attestation.py').exists():
        from source_attestation import git_source_identity
        namespace['git_source_identity']=git_source_identity
    exec(compile(ast.Module(body=[fn],type_ignores=[]),'actual-prepare-foreground-ident','exec'),namespace)
    return namespace['ident'](root)

class MetadataAttestation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='trellis-source-status-')
        self.root=Path(self.temp.name)
        def git(*args):
            return subprocess.check_output(['git',*args],cwd=self.root,text=True,stderr=subprocess.DEVNULL)
        self.git=git
        git('init','-q');git('config','user.name','Local contract test');git('config','user.email','test@example.invalid')
        git('config','core.excludesFile','/dev/null')
        (self.root/'model.py').write_text('source = 1\n');git('add','model.py');git('commit','-qm','fixture')
    def tearDown(self):self.temp.cleanup()

    def test_metadata_arriving_during_work_does_not_change_source_identity(self):
        before=production_identity(self.root)
        (self.root/'.DS_Store').write_bytes(b'Finder metadata')
        (self.root/'folder with spaces').mkdir()
        (self.root/'folder with spaces'/'.DS_Store').write_bytes(b'nested metadata')
        after=production_identity(self.root)
        self.assertEqual(after['dirty'],'','untracked Finder metadata still rejects the actual preprocessing source')
        self.assertEqual(after['commit'],before['commit'])
        self.assertEqual(set(after['ignoredUntrackedMetadata']),{'.DS_Store','folder with spaces/.DS_Store'})

    def test_tracked_source_modification_is_not_ignored(self):
        (self.root/'model.py').write_text('source = 2\n')
        self.assertTrue(production_identity(self.root)['dirty'])

    def test_other_untracked_files_and_metadata_lookalikes_still_fail_cleanliness(self):
        for name in ['new.py','.DS_Store.py','.DS_Store-extra','weights.bin']:
            with self.subTest(name=name):
                path=self.root/name;path.write_bytes(b'not metadata')
                self.assertTrue(production_identity(self.root)['dirty']);path.unlink()

    def test_a_tracked_metadata_named_file_is_not_silently_excluded(self):
        path=self.root/'.DS_Store';path.write_bytes(b'tracked data');self.git('add','.DS_Store');self.git('commit','-qm','tracked fixture')
        path.write_bytes(b'changed tracked data')
        self.assertTrue(production_identity(self.root)['dirty'])

if __name__=='__main__':unittest.main()
