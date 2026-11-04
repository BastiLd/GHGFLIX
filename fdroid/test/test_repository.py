import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

FILE = Path(__file__).resolve().parents[1] / 'tools/repository.py'
SPEC = importlib.util.spec_from_file_location('ghgflix_fdroid', FILE)
repo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repo)
DEPLOY_SPEC = importlib.util.spec_from_file_location('ghgflix_fdroid_deploy', FILE.with_name('deploy.py'))
deploy = importlib.util.module_from_spec(DEPLOY_SPEC)
with patch.dict(sys.modules, {'repository': repo}):
    DEPLOY_SPEC.loader.exec_module(deploy)


class RepositorySecurity(unittest.TestCase):
    def setUp(self):
        self.config = repo.settings()
        self.package = 'com.bastild.ghgflix'
        self.cert = self.config['apps'][self.package]['certificate_sha256']

    def identity(self, package=None, code=24, cert=None, extra=''):
        badging = "package: name='%s' versionCode='%s' versionName='3.7.0'\n%s" % (package or self.package, code, extra)
        return badging, 'Signer #1 certificate SHA-256 digest: ' + (cert or self.cert) + '\n'

    def test_both_existing_product_signers_are_accepted(self):
        for package, info in self.config['apps'].items():
            with self.subTest(package=package):
                row = repo.parse_apk_identity(*self.identity(package=package, cert=info['certificate_sha256']), self.config)
                self.assertEqual((row['package'], row['versionCode']), (package, 24))

    def test_unknown_package_is_rejected(self):
        with self.assertRaises(ValueError):
            repo.parse_apk_identity(*self.identity(package='malicious.other'), self.config)

    def test_a_different_key_for_the_same_app_is_rejected(self):
        with self.assertRaises(ValueError):
            repo.parse_apk_identity(*self.identity(cert='0' * 64), self.config)

    def test_multiple_apk_signers_are_rejected(self):
        badging, cert = self.identity()
        with self.assertRaises(ValueError):
            repo.parse_apk_identity(badging, cert + cert.replace('#1', '#2'), self.config)

    def test_debug_build_is_rejected(self):
        with self.assertRaises(ValueError):
            repo.parse_apk_identity(*self.identity(extra='application-debuggable'), self.config)

    def test_invalid_android_version_codes_are_rejected(self):
        for code in [0, 2100000001]:
            with self.subTest(code=code), self.assertRaises(ValueError):
                repo.parse_apk_identity(*self.identity(code=code), self.config)

    def test_malformed_manifest_output_is_rejected(self):
        with self.assertRaises(ValueError):
            repo.parse_apk_identity('not an APK', '', self.config)

    def test_conflicting_apks_cannot_reuse_a_version_code(self):
        rows = [{'package': self.package, 'versionCode': 24, 'sha256': 'a'}, {'package': self.package, 'versionCode': 24, 'sha256': 'b'}]
        with self.assertRaises(ValueError):
            repo.keep_versions(rows, 2)

    def test_identical_duplicate_is_deduplicated(self):
        row = {'package': self.package, 'versionCode': 24, 'sha256': 'a'}
        self.assertEqual(repo.keep_versions([row, dict(row)], 2), [row])

    def test_retention_uses_highest_version_codes_for_each_app(self):
        rows = [{'package': package, 'versionCode': code, 'sha256': str(code)} for package in self.config['apps'] for code in [19, 21, 24]]
        selected = repo.keep_versions(rows, 2)
        for package in self.config['apps']:
            self.assertEqual([r['versionCode'] for r in selected if r['package'] == package], [24, 21])

    def test_private_and_executable_files_never_publish(self):
        for filename in ['key.p12', 'key.jks', 'config.yml', 'run.py', '.env']:
            with self.subTest(filename=filename), tempfile.TemporaryDirectory() as temp:
                site = Path(temp)
                (site / filename).write_text('secret')
                with self.assertRaises(ValueError):
                    repo.validate_public_tree(site)

    def test_public_certificate_is_allowed_but_appended_private_material_is_not(self):
        pem = (repo.SOURCE / 'repo-signing-cert.pem').read_text()
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp)
            (site / 'fdroid').mkdir()
            cert = site / 'fdroid/certificate.pem'
            cert.write_text(pem)
            repo.validate_public_tree(site)
            cert.write_text(pem + '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----')
            with self.assertRaises(ValueError):
                repo.validate_public_tree(site)

    def test_noncanonical_certificate_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp)
            (site / 'fdroid').mkdir()
            (site / 'fdroid/certificate.pem').write_text('-----BEGIN CERTIFICATE-----\nYQ==\n-----END CERTIFICATE-----\n')
            with self.assertRaises(ValueError):
                repo.validate_public_tree(site)

    def test_pem_whitelist_is_limited_to_the_expected_public_certificate_path(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp)
            (site / 'certificate.pem').write_text('private material under a misleading name')
            with self.assertRaises(ValueError):
                repo.validate_public_tree(site)

    @unittest.skipIf(os.name == 'nt', 'Symlink creation requires Windows privileges; exercised on Linux CI')
    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            site = Path(temp)
            (site / 'outside.txt').write_text('not publication data')
            (site / 'link.txt').symlink_to(site / 'outside.txt')
            with self.assertRaises(ValueError):
                repo.validate_public_tree(site)

    def test_download_host_is_restricted_before_network_access(self):
        with tempfile.TemporaryDirectory() as temp, patch('urllib.request.urlopen') as network:
            with self.assertRaises(ValueError):
                repo.download_asset({'browser_download_url': 'https://evil.example/app.apk', 'size': 1}, Path(temp) / 'a.apk', self.config['github_repository'])
            network.assert_not_called()

    def test_large_download_is_rejected_before_network_access(self):
        asset = {'browser_download_url': 'https://github.com/BastiLd/GHGFLIX/releases/download/v3.7.0/a.apk', 'size': repo.MAX_APK_BYTES + 1}
        with tempfile.TemporaryDirectory() as temp, patch('urllib.request.urlopen') as network:
            with self.assertRaises(ValueError):
                repo.download_asset(asset, Path(temp) / 'a.apk', self.config['github_repository'])
            network.assert_not_called()

    def test_asset_hash_mismatch_is_rejected(self):
        asset = {'browser_download_url': 'https://github.com/BastiLd/GHGFLIX/releases/download/v3.7.0/a.apk', 'size': 3, 'digest': 'sha256:' + '0' * 64}
        with tempfile.TemporaryDirectory() as temp, patch('urllib.request.urlopen', return_value=io.BytesIO(b'apk')):
            with self.assertRaises(ValueError):
                repo.download_asset(asset, Path(temp) / 'a.apk', self.config['github_repository'])

    def test_public_asset_download_has_no_authorization_header(self):
        url = 'https://github.com/BastiLd/GHGFLIX/releases/download/v3.7.0/a.apk'
        asset = {'browser_download_url': url, 'size': 3, 'digest': 'sha256:' + hashlib.sha256(b'apk').hexdigest()}
        with tempfile.TemporaryDirectory() as temp, patch('urllib.request.urlopen', return_value=io.BytesIO(b'apk')) as network:
            repo.download_asset(asset, Path(temp) / 'a.apk', self.config['github_repository'])
            network.assert_called_once_with(url, timeout=60)

    def test_secret_bytes_are_rejected_even_inside_an_allowed_file_type(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'index.json').write_bytes(b'public text followed by a-private-password')
            with self.assertRaises(ValueError):
                repo.reject_secret_material(directory, [b'a-private-password'])

    def test_secret_scan_crosses_chunk_boundaries(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            (directory / 'app.apk').write_bytes(b'a' * (1024 * 1024 - 4) + b'private-bytes')
            with self.assertRaises(ValueError):
                repo.reject_secret_material(directory, [b'private-bytes'])

    def test_actions_are_pinned_and_signing_is_not_run_on_pull_request_target(self):
        import re
        workflow = (repo.ROOT / '.github/workflows/fdroid.yml').read_text()
        self.assertNotIn('pull_request_target', workflow)
        for action in re.findall(r'uses: (\S+)', workflow):
            self.assertRegex(action, r'@([0-9a-f]{40})$')
        self.assertIn('environment: fdroid-signing', workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)

    def remote_snapshot(self, timestamp=1234):
        return {'repo': {'timestamp': timestamp}, 'packages': {package: {'versions': {'hash': {'manifest': {'versionCode': 24}}}} for package in self.config['apps']}}

    def test_a_valid_but_stale_publication_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'different signed snapshot'):
            repo.validate_remote_snapshot(self.remote_snapshot(), self.config, '1235')

    def test_the_exact_expected_publication_is_accepted(self):
        versions = repo.validate_remote_snapshot(self.remote_snapshot(), self.config, '1234')
        self.assertEqual(versions, {package: [24] for package in self.config['apps']})

    def test_remote_extra_app_is_rejected(self):
        data = self.remote_snapshot()
        data['packages']['unknown.app'] = {'versions': {}}
        with self.assertRaisesRegex(ValueError, 'unexpected applications'):
            repo.validate_remote_snapshot(data, self.config, '1234')

    def test_an_automatically_queued_pages_build_is_not_requested_twice(self):
        api = Mock(side_effect=[{'commit': 'old', 'status': 'built'}, {'commit': 'new', 'status': 'building'}])
        with patch('builtins.print'), patch.object(deploy.time, 'sleep') as pause:
            deploy.ensure_pages_build(api, 'new')
        self.assertEqual(api.call_args_list, [call('pages/builds/latest'), call('pages/builds/latest')])
        pause.assert_called_once_with(2)

    def test_missing_automatic_pages_trigger_uses_one_explicit_request(self):
        api = Mock(return_value={'commit': 'old', 'status': 'built'})
        with patch('builtins.print'), patch.object(deploy.time, 'sleep') as pause:
            deploy.ensure_pages_build(api, 'new')
        self.assertEqual(api.call_count, 11)
        self.assertEqual(api.call_args, call('pages/builds', '--method', 'POST'))
        self.assertEqual(pause.call_count, 9)

    def test_an_already_built_pages_revision_is_idempotent(self):
        api = Mock(return_value={'commit': 'new', 'status': 'built'})
        with patch('builtins.print'), patch.object(deploy.time, 'sleep') as pause:
            deploy.ensure_pages_build(api, 'new')
        api.assert_called_once_with('pages/builds/latest')
        pause.assert_not_called()



if __name__ == '__main__':
    unittest.main()
