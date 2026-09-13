import importlib.util
import pathlib
import unittest
from unittest.mock import patch
p=pathlib.Path(__file__).parents[1]/'tools/collect.py'
spec=importlib.util.spec_from_file_location('collect',p)
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class CollectorTests(unittest.TestCase):
    def test_sensitive_queries(self):
        self.assertNotIn('supersecret',c.normalize('https://example.org/api?token=supersecret&id=12'))
        self.assertIn('id=12',c.normalize('https://example.org/api?token=supersecret&id=12'))
    def test_rejects_nonweb_and_userinfo(self):
        for u in ['https://u:p@example.org/','file:///etc/passwd','http://a.test:8080/','javascript:alert(1)']: self.assertIsNone(c.normalize(u))
    def test_preserves_domain_distinctions(self):
        self.assertEqual(c.normalize('HTTPS://EXAMPLE.ORG:443/a#b'),'https://example.org/a')
        self.assertNotEqual(c.normalize('https://www.example.org'),c.normalize('https://example.org'))
    def test_listing_occurrences(self):
        html='<main class="vp-doc"><h2>Streaming</h2><ul><li><a href="https://a.test">A</a> or <a href="https://b.test">B</a></li><li><a href="https://a.test">A</a></li></ul></main>'
        entries,resources=c.extract_listing(html,'https://fmhy.net/video')
        self.assertEqual(len(entries),2);self.assertEqual(len(resources),2)
        self.assertNotEqual(entries[0]['id'],entries[1]['id'])
    def test_source_references(self):
        refs,frameworks=c.inspect_text('<script src="/_next/a.js"></script><iframe src="https://embed.test/e"></iframe><script>fetch("/api/search")</script>','https://example.org')
        self.assertTrue(any(r['url']=='https://example.org/api/search' for r in refs))
        self.assertTrue(any(f['name']=='Next.js' for f in frameworks))
    def test_repository_normalization(self):
        self.assertEqual(c.repository('https://github.com/org/project/blob/main/a.ts'),'https://github.com/org/project')
        self.assertIsNone(c.repository('https://github.com/settings/profile'))
    def test_private_address_denied(self):
        with patch.object(c.socket,'getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]): self.assertFalse(c.public_address('example.org')[0])
    def test_password_redaction(self): self.assertNotIn('privatepw',c.safe_text('Title / PW: privatepw / Movies'))
if __name__=='__main__': unittest.main()
