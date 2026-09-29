import importlib.util, unittest
from pathlib import Path
P=Path(__file__).resolve().parents[1]/'query.py'
spec=importlib.util.spec_from_file_location('source_audit_query',P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class AuditTests(unittest.TestCase):
 def test_schema(self):self.assertTrue(m.validate(m.audit())['passed'])
 def test_counts(self):self.assertEqual(len(m.audit()['documents']),61)
 def test_all_entries_retained(self):self.assertEqual(len(m.coverage()['entries']),946)
 def test_all_primary_entries_attempted(self):self.assertEqual(m.coverage()['summary']['combined_entries_with_primary_inspection_attempt'],946)
 def test_no_false_completion(self):self.assertFalse(any(r['complete'] for r in m.coverage()['entries']))
 def test_exact_domain_distinctions(self):self.assertNotEqual(m.normalized('https://vidfast.net/'),m.normalized('https://vidfast.pro/'))
 def test_bindings(self):self.assertEqual(len(m.bindings()),len(m.audit()['entities']))
 def test_meowly_servers(self):self.assertEqual(sum(x['source']=='meowly' and x['relation']=='configures_iframe_provider' for x in m.audit()['relationships']),11)
 def test_fishy_servers(self):self.assertEqual(sum(x['source']=='fishystream' and x['relation']=='declares_provider' for x in m.audit()['relationships']),27)
 def test_real_media_not_claimed(self):self.assertFalse(any(x['tested'] for x in m.audit()['endpoints']))
if __name__=='__main__':unittest.main()
