import pathlib, sys, unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'tools'))
import audit
class EvidenceQualityTests(unittest.TestCase):
    def test_host_expression_not_domain(self):
        self.assertFalse(audit.valid_hostname('${t'));self.assertFalse(audit.valid_hostname('bad_host.test'));self.assertTrue(audit.valid_hostname('api.example.org'))
    def test_url_template_not_concrete_endpoint(self): self.assertEqual(audit.shape('https://api.example.org/${id}'),'url-template')
    def test_script_request_not_api(self): self.assertFalse(audit.api_like({'url':'https://cdn.example.org/app.js','kind':'browser-request-sent','resource_type':'script'}))
    def test_fetch_reference_is_candidate(self): self.assertTrue(audit.api_like({'url':'https://api.example.org/v1','kind':'source-literal'}))
    def test_forge_repository(self): self.assertEqual(audit.forge_repo('https://codeberg.org/pee/extension/src/branch/main/a.js'),'https://codeberg.org/pee/extension')
    def test_schema_namespace_not_dependency(self): self.assertEqual(audit.shape('https://www.w3.org/2000/svg'),'schema-or-standard-reference')
if __name__=='__main__': unittest.main()
