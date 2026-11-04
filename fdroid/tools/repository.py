"""Publish already-signed APKs with the official F-Droid tools, never re-sign apps."""
import argparse
import base64
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'fdroid'
MAX_APK_BYTES = 95 * 1024 * 1024


def settings():
    value = json.loads((SOURCE / 'repository.json').read_text(encoding='utf-8'))
    if not re.fullmatch(r'[A-F0-9]{64}', value['fingerprint']):
        raise ValueError('A fixed public repository fingerprint is required')
    if value['github_repository'] != 'BastiLd/GHGFLIX':
        raise ValueError('Unexpected source repository')
    if value['url'] != 'https://bastild.github.io/GHGFLIX/fdroid/repo':
        raise ValueError('Unexpected canonical F-Droid URL')
    return value


def sdk_tool(name):
    home = os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT')
    if not home and os.name == 'nt':
        home = str(Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk')
    if not home:
        raise RuntimeError('ANDROID_HOME is required')
    base = Path(home) / 'build-tools/36.0.0'
    if name == 'apksigner':
        return ['java', '-jar', str(base / 'lib/apksigner.jar')]
    return [str(base / ('aapt.exe' if os.name == 'nt' else 'aapt'))]


def parse_apk_identity(badging, certificate_output, config):
    match = re.search(r"^package: name='([^']+)' versionCode='([0-9]+)' versionName='([^']*)'", badging, re.M)
    if not match or match[1] not in config['apps']:
        raise ValueError('APK package is not in the explicit allowlist')
    package, code, version = match.groups()
    certificates = re.findall(r'^Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$', certificate_output, re.M)
    if len(certificates) != 1 or certificates[0].lower() != config['apps'][package]['certificate_sha256']:
        raise ValueError('APK signing certificate does not match the existing release key')
    if 'application-debuggable' in badging or int(code) < 1 or int(code) > 2100000000:
        raise ValueError('Debug APK or invalid Android versionCode')
    return {'package': package, 'versionCode': int(code), 'versionName': version, 'signer': certificates[0].lower()}


def inspect_apk(apk, config):
    if apk.is_symlink() or not apk.is_file() or not 0 < apk.stat().st_size <= MAX_APK_BYTES:
        raise ValueError('APK must be a bounded regular file')
    signed = subprocess.run(sdk_tool('apksigner') + ['verify', '--print-certs', str(apk)], check=True, capture_output=True, text=True)
    badging = subprocess.check_output(sdk_tool('aapt') + ['dump', 'badging', str(apk)], text=True, encoding='utf-8')
    result = parse_apk_identity(badging, signed.stdout, config)
    result.update(sha256=hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest(), bytes=apk.stat().st_size)
    return result


def download_asset(asset, target, repository):
    url = urllib.parse.urlsplit(asset['browser_download_url'])
    if url.scheme != 'https' or url.netloc != 'github.com' or not url.path.startswith('/' + repository + '/releases/download/'):
        raise ValueError('APK download must originate from this GitHub repository')
    if not 0 < asset.get('size', 0) <= MAX_APK_BYTES:
        raise ValueError('Unexpected APK download size')
    digest = hashlib.sha256()
    size = 0
    # Public APK download deliberately receives no API credential, including on redirects.
    with urllib.request.urlopen(asset['browser_download_url'], timeout=60) as response, target.open('xb') as output:
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_APK_BYTES:
                raise ValueError('APK download exceeded the size limit')
            digest.update(chunk)
            output.write(chunk)
    if size != asset['size']:
        raise ValueError('Incomplete APK download')
    expected = asset.get('digest')
    if expected and expected != 'sha256:' + digest.hexdigest():
        raise ValueError('GitHub asset SHA-256 mismatch')
    if asset.get('updated_at'):
        modified = datetime.fromisoformat(asset['updated_at'].replace('Z', '+00:00')).timestamp()
        os.utime(target, (modified, modified))


def keep_versions(candidates, limit):
    result = []
    by_version = {}
    for item in candidates:
        key = (item['package'], item['versionCode'])
        if key in by_version and by_version[key]['sha256'] != item['sha256']:
            raise ValueError('Different APK bytes reuse the same package/versionCode')
        by_version[key] = item
    for package in sorted({x['package'] for x in candidates}):
        rows = sorted((x for x in by_version.values() if x['package'] == package), key=lambda x: x['versionCode'], reverse=True)
        result.extend(rows[:limit])
    return result


def prepare(work):
    from ruamel.yaml import YAML
    config = settings()
    if work.exists():
        raise ValueError('Use a new temporary work directory')
    work.mkdir(parents=True)
    (work / 'repo').mkdir()
    shutil.copytree(SOURCE / 'metadata', work / 'metadata')
    request = urllib.request.Request('https://api.github.com/repos/' + config['github_repository'] + '/releases?per_page=20', headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'GHGFlix-FDroid'})
    if os.environ.get('GH_TOKEN'):
        request.add_header('Authorization', 'Bearer ' + os.environ['GH_TOKEN'])
    with urllib.request.urlopen(request, timeout=30) as response:
        releases = json.load(response)
    candidates = []
    with tempfile.TemporaryDirectory(prefix='ghgflix-apks-') as temp:
        downloads = Path(temp)
        counts = {package: 0 for package in config['apps']}
        for release in releases:
            if release['draft'] or release['prerelease']:
                continue
            for package, info in config['apps'].items():
                if counts[package] >= config['versions_per_app']:
                    continue
                matches = [a for a in release['assets'] if re.fullmatch(info['asset_pattern'], a['name'])]
                if len(matches) > 1:
                    raise ValueError('Ambiguous release APK assets')
                if not matches:
                    continue
                if not isinstance(matches[0]['id'], int) or matches[0]['id'] <= 0:
                    raise ValueError('Invalid GitHub asset identifier')
                target = downloads / (str(matches[0]['id']) + '.apk')
                download_asset(matches[0], target, config['github_repository'])
                row = inspect_apk(target, config)
                if row['package'] != package:
                    raise ValueError('Release APK belongs to the wrong product')
                row['path'] = str(target)
                candidates.append(row)
                counts[package] += 1
        for apk in sorted((SOURCE / 'repo').glob('*.apk')):
            row = inspect_apk(apk, config)
            row['path'] = str(apk)
            candidates.append(row)
        selected = keep_versions(candidates, config['versions_per_app'])
        if {r['package'] for r in selected} != set(config['apps']):
            raise ValueError('Refusing to publish a repository with missing products')
        for row in selected:
            name = row['package'] + '_' + str(row['versionCode']) + '.apk'
            shutil.copy2(row.pop('path'), work / 'repo' / name)
            row['file'] = name
    yaml = YAML()
    for package, info in config['apps'].items():
        metadata_path = work / 'metadata' / (package + '.yml')
        metadata = yaml.load(metadata_path)
        current = max((r for r in selected if r['package'] == package), key=lambda x: x['versionCode'])
        metadata['CurrentVersion'] = current['versionName']
        metadata['CurrentVersionCode'] = current['versionCode']
        metadata['AllowedAPKSigningKeys'] = [info['certificate_sha256']]
        with metadata_path.open('w', encoding='utf-8') as output:
            yaml.dump(metadata, output)
    (work / 'repo/icons').mkdir()
    shutil.copyfile(ROOT / 'mobile/assets/app-icon.png', work / 'icon.png')
    cfg = {'repo_url': config['url'], 'repo_name': config['name'], 'repo_description': config['description'], 'repo_icon': 'icon.png', 'repo_maxage': 1209600, 'archive_older': 0, 'make_current_version_link': False, 'repo_keyalias': config['key_alias'], 'keystore': {'env': 'FDROID_KEYSTORE_PATH'}, 'keystorepass': {'env': 'FDROID_KEYSTORE_PASSWORD'}, 'keypass': {'env': 'FDROID_KEYSTORE_PASSWORD'}, 'build_tools': '36.0.0'}
    with (work / 'config.yml').open('w', encoding='utf-8') as output:
        yaml.dump(cfg, output)
    (work / 'config.yml').chmod(0o600)
    (work / 'validated-apks.json').write_text(json.dumps(selected, indent=2) + '\n', encoding='utf-8')
    print('Validated', len(selected), 'existing release APKs; package identities and certificates match')


def verify_indexes(repo, config):
    from fdroidserver import common, index
    from fdroidserver.exception import VerificationException
    # F-Droid's own validators, not a custom implementation of JAR signatures.
    common.config = common.read_config()
    entry, _, actual = index.get_index_from_jar(str(repo / 'entry.jar'), config['fingerprint'])
    try:
        index.get_index_from_jar(str(repo / 'entry.jar'), '0' * 64)
    except VerificationException:
        pass
    else:
        raise ValueError('Wrong repository fingerprint was accepted')
    with tempfile.TemporaryDirectory(prefix='ghgflix-tamper-test-') as temp:
        tampered = Path(temp) / 'entry.jar'
        with zipfile.ZipFile(repo / 'entry.jar') as original, zipfile.ZipFile(tampered, 'w') as changed:
            for item in original.infolist():
                data = original.read(item.filename)
                changed.writestr(item, data + b'\n' if item.filename == 'entry.json' else data)
        try:
            index.get_index_from_jar(str(tampered), config['fingerprint'])
        except VerificationException:
            pass
        else:
            raise ValueError('Tampered signed index was accepted')
    descriptor = entry['index']
    raw = (repo / 'index-v2.json').read_bytes()
    if descriptor['sha256'] != hashlib.sha256(raw).hexdigest() or descriptor['size'] != len(raw):
        raise ValueError('Signed v2 entry does not authenticate the index bytes')
    v1, _, _ = index.get_index_from_jar(str(repo / 'index-v1.jar'), config['fingerprint'], allow_deprecated=True)
    if set(v1['packages']) != set(config['apps']):
        raise ValueError('Unexpected indexed applications')
    summary = {}
    for package, versions in v1['packages'].items():
        for version in versions:
            if version['signer'].lower() != config['apps'][package]['certificate_sha256']:
                raise ValueError('Indexed APK certificate mismatch')
            apk = repo / version['apkName']
            if apk.parent != repo or apk.is_symlink() or hashlib.file_digest(apk.open('rb'), 'sha256').hexdigest() != version['hash']:
                raise ValueError('Indexed APK bytes do not match')
        summary[package] = sorted(v['versionCode'] for v in versions)
    return {'fingerprint': actual, 'versions': summary, 'v1SignatureVerified': True, 'v2EntrySignatureAndIndexHashVerified': True, 'wrongFingerprintRejected': True, 'tamperedIndexRejected': True}


def validate_public_tree(site):
    forbidden = {'.jks', '.p12', '.pfx', '.keystore', '.py', '.yml', '.yaml'}
    allowed = {'.apk', '.jar', '.json', '.xml', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.txt', '.html', '.css'}
    for item in site.rglob('*'):
        if item.is_symlink():
            raise ValueError('Symlink in publication output')
        if item.is_file() and item.relative_to(site).as_posix() not in {'.nojekyll', 'fdroid/certificate.pem'}:
            if item.suffix.lower() in forbidden or item.suffix.lower() not in allowed:
                raise ValueError('Unexpected file type in publication output: ' + item.name)
        if item.relative_to(site).as_posix() == '.nojekyll' and item.stat().st_size != 0:
            raise ValueError('The Pages marker must be empty')
    cert = site / 'fdroid/certificate.pem'
    if cert.exists():
        pem = re.fullmatch(r'-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\r\n]+)-----END CERTIFICATE-----\s*', cert.read_text())
        if not pem:
            raise ValueError('Only the public certificate may be published')
        der = base64.b64decode(re.sub(r'\s', '', pem[1]), validate=True)
        if hashlib.sha256(der).hexdigest().upper() != settings()['fingerprint']:
            raise ValueError('Published public certificate does not match the pinned fingerprint')


def reject_secret_material(directory, values):
    patterns = [v for v in values if v]
    overlap = max(map(len, patterns), default=1) - 1
    for item in directory.rglob('*'):
        if not item.is_file():
            continue
        tail = b''
        with item.open('rb') as source:
            while chunk := source.read(1024 * 1024):
                data = tail + chunk
                if any(value in data for value in patterns):
                    raise ValueError('Private signing material was found in publication output')
                tail = data[-overlap:] if overlap else b''


def sign(work, site):
    config = settings()
    encoded = os.environ.pop('FDROID_KEYSTORE_BASE64', '')
    if not encoded or not os.environ.get('FDROID_KEYSTORE_PASSWORD'):
        raise ValueError('Permanent repository signing secrets are missing; no automatic key generation')
    if site.exists():
        raise ValueError('Use a new publication directory')
    with tempfile.TemporaryDirectory(prefix='ghgflix-fdroid-key-') as temp:
        keystore = Path(temp) / 'index.p12'
        private_bytes = base64.b64decode(encoded, validate=True)
        keystore.write_bytes(private_bytes)
        keystore.chmod(0o600)
        certificate = subprocess.check_output(['keytool', '-exportcert', '-keystore', str(keystore), '-alias', config['key_alias'], '-storepass:env', 'FDROID_KEYSTORE_PASSWORD'])
        if hashlib.sha256(certificate).hexdigest().upper() != config['fingerprint']:
            raise ValueError('Repository signing key differs from the pinned permanent fingerprint')
        os.environ['FDROID_KEYSTORE_PATH'] = str(keystore)
        subprocess.run(['fdroid', 'update'], cwd=work, check=True)
        validate_public_tree(work / 'repo')
        reject_secret_material(work / 'repo', [private_bytes, encoded.encode(), os.environ['FDROID_KEYSTORE_PASSWORD'].encode()])
        previous = Path.cwd()
        try:
            os.chdir(work)
            verified = verify_indexes(work / 'repo', config)
        finally:
            os.chdir(previous)
            os.environ.pop('FDROID_KEYSTORE_PATH', None)
    # Publish only generated public repository data. Config/metadata/keystore stay outside.
    (site / 'fdroid').mkdir(parents=True)
    shutil.copytree(work / 'repo', site / 'fdroid/repo', symlinks=True)
    shutil.copyfile(SOURCE / 'repo-signing-cert.pem', site / 'fdroid/certificate.pem')
    (site / '.nojekyll').touch()
    verified.update(sourceCommit=os.environ.get('GITHUB_SHA', ''), url=config['url'])
    (site / 'fdroid/verification.json').write_text(json.dumps(verified, indent=2) + '\n', encoding='utf-8')
    marker = {'publisher': 'GHGFlix F-Droid', 'fingerprint': config['fingerprint']}
    (site / '.fdroid-publisher.json').write_text(json.dumps(marker) + '\n', encoding='utf-8')
    url = config['url'] + '?fingerprint=' + config['fingerprint']
    page = '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>GHGFlix F-Droid</title><style>body{font:18px system-ui;max-width:800px;margin:4rem auto;padding:1rem;background:#101016;color:#f5f5fa}a{color:#ff707a}code{overflow-wrap:anywhere}p{line-height:1.6}</style><h1>GHGFlix für F-Droid</h1><p>In F-Droid unter Einstellungen → Paketquellen diese URL hinzufügen:</p><p><code>' + html.escape(url) + '</code></p><p>SHA-256-Fingerabdruck des Repository-Zertifikats:</p><p><code>' + config['fingerprint'] + '</code></p><p>Enthält getrennte Handy- und TV-Apps. Die bestehenden APK-Signaturen bleiben erhalten. Ein Update benötigt eine höhere Android-versionCode und denselben App-Signierer.</p><p><a href="https://github.com/BastiLd/GHGFLIX/releases">Release-Downloads</a> · <a href="https://github.com/BastiLd/GHGFLIX/blob/main/docs/FDROID.md">Einrichtung und Schlüssel-Backup</a></p></html>'
    (site / 'index.html').write_text(page, encoding='utf-8')
    validate_public_tree(site)
    print(json.dumps(verified, indent=2))


def verify_remote():
    from fdroidserver import common, index
    config = settings()
    common.config = {}
    common.fill_config_defaults(common.config)
    data, _ = index.download_repo_index_v2(config['url'] + '?fingerprint=' + config['fingerprint'], timeout=60)
    if set(data['packages']) != set(config['apps']):
        raise ValueError('Published repository has unexpected applications')
    versions = {package: sorted(v['manifest']['versionCode'] for v in row['versions'].values()) for package, row in data['packages'].items()}
    print(json.dumps({'url': config['url'], 'fingerprintVerified': True, 'publishedVersions': versions}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'sign', 'verify-remote'])
    parser.add_argument('--work-dir', type=Path)
    parser.add_argument('--site-dir', type=Path)
    args = parser.parse_args()
    if args.command == 'prepare':
        prepare(args.work_dir.resolve())
    elif args.command == 'sign':
        sign(args.work_dir.resolve(), args.site_dir.resolve())
    else:
        verify_remote()
