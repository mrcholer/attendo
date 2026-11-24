from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
import time
import intra_credentials as credentials

class CredentialTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'xattendo' / 'intra-credentials.json'
        self.patcher = patch.object(credentials, 'path', return_value=self.path)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        credentials.CACHE = None
        self.addCleanup(setattr, credentials, 'CACHE', None)

    def test_connect_renew_disconnect(self):
        with patch.object(credentials, 'exchange', side_effect=[('access1', time.time()+7200),('access2',time.time()+7200)]) as request:
            result = credentials.connect('uid','secret')
            self.assertTrue(result['connected'])
            self.assertNotIn('secret', str(result))
            self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(credentials.managed_token(), 'access1')
            self.assertEqual(credentials.managed_token(force=True), 'access2')
            self.assertEqual(request.call_count,2)
            self.assertFalse(credentials.disconnect()['configured'])
            self.assertFalse(self.path.exists())

    def test_failed_exchange_does_not_replace_credentials(self):
        with patch.object(credentials,'exchange',return_value=('access',time.time()+7200)):
            credentials.connect('uid','secret')
        before=self.path.read_text()
        with patch.object(credentials,'exchange',side_effect=credentials.CredentialError('Rejected')):
            with self.assertRaises(credentials.CredentialError):
                credentials.connect('different','secret2')
        self.assertEqual(self.path.read_text(),before)

    def test_bad_permissions(self):
        credentials.save_credentials('uid','secret')
        self.path.chmod(0o644)
        with self.assertRaises(credentials.CredentialError):
            credentials.read_credentials()
