import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'tools'))
import scrub
class PrivacyTests(unittest.TestCase):
    def test_transient_query_redaction(self):
        self.assertNotIn('privatevalue',scrub.scrub_url('https://example.org/api?csrfNonce=privatevalue&id=12'))
    def test_normal_query_preserved(self):
        self.assertEqual(scrub.scrub_url('https://example.org/api?id=12&q=movie'),'https://example.org/api?id=12&q=movie')
    def test_nested_return_url(self):
        self.assertNotIn('privatevalue',scrub.scrub_url('https://example.org/?returnUrl=https%3A%2F%2Fb.example.org%2F%3Fstate%3Dprivatevalue'))
if __name__=='__main__':unittest.main()
