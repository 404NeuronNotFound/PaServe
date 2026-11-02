import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-secrets.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class SecretAuditTests(unittest.TestCase):
    def test_private_provider_patterns_and_configured_values(self):
        for prefix in [b'sb_' + b'secret_', b'xkeysib' + b'-', b'xsmtpsib' + b'-', b'gh' + b'p_', b'sk_' + b'live_', b'sk-' + b'proj-']:
            self.assertTrue(audit.detect(prefix + b'Z' * 45))
        self.assertIn('configured private credential', audit.detect(b'custom-value-in-bundle', [b'custom-value-in-bundle']))

    def test_supabase_roles(self):
        for role in ['anon', 'service_role']:
            payload = base64.urlsafe_b64encode(json.dumps({'role': role}).encode()).rstrip(b'=')
            token = b'eyJfixture.' + payload + b'.fixture'
            self.assertEqual('privileged Supabase JWT' in audit.detect(token), role == 'service_role')

    def test_exact_fixture_suppression_never_hides_other_keys_or_configured_secrets(self):
        fake = (b'sk_' + b'live_') + b'Z' * 24
        allow = {('Stripe/OpenAI private key', hashlib.sha256(fake).hexdigest())}
        self.assertFalse(audit.detect(fake, approved=allow))
        self.assertTrue(audit.detect(fake + b'X', approved=allow))
        self.assertIn('configured private credential', audit.detect(fake, [fake], allow))

    def test_private_key_and_malformed_jwt(self):
        header = b'-----BEGIN ' + b'PRIVATE KEY-----'
        self.assertIn('private key', audit.detect(header))
        self.assertEqual(audit.detect(b'eyJheader.bnVsbA.signature'), [])

if __name__ == '__main__':
    unittest.main()
