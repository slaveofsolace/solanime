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
    def test_local_home_paths_are_redacted(self):
        separator=chr(92)
        windows_home=separator.join(('C:','Users','fixture-user','capture'))
        linux_home='/'+'home'+'/'+'fixture-user'+'/'+'download'
        value=f'{windows_home} and {linux_home}'
        result=scrub.scrub_text(value)
        self.assertNotIn('fixture-user',result)
        self.assertEqual(result,'<LOCAL_HOME>\\capture and <LOCAL_HOME>/download')
    def test_email_addresses_are_redacted(self):
        fixture_email='person'+'@'+'example.org'
        self.assertEqual(scrub.scrub_text(f'Contact {fixture_email}'), 'Contact <PUBLIC_EMAIL_REDACTED>')
if __name__=='__main__':unittest.main()
