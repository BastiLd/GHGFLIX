"""Append a public snapshot to the dedicated gh-pages branch and request Pages build."""
import argparse
import base64
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from repository import settings, validate_public_tree


def deploy(site):
    config = settings()
    validate_public_tree(site)
    token = os.environ['GH_TOKEN']
    env = dict(os.environ)
    for key in ['GIT_TRACE', 'GIT_CURL_VERBOSE', 'GIT_TRACE_CURL']:
        env.pop(key, None)
    env.update(GIT_TERMINAL_PROMPT='0', GIT_CONFIG_COUNT='1', GIT_CONFIG_KEY_0='http.https://github.com/.extraheader', GIT_CONFIG_VALUE_0='AUTHORIZATION: basic ' + base64.b64encode(('x-access-token:' + token).encode()).decode())

    def api(endpoint, *args):
        return json.loads(subprocess.check_output(['gh', 'api', 'repos/' + config['github_repository'] + '/' + endpoint, *args], env=env))

    source = json.loads((site / 'fdroid/verification.json').read_text())['sourceCommit']
    if api('git/ref/heads/main')['object']['sha'] != source:
        raise ValueError('A newer main revision exists; refusing to publish a stale snapshot')
    with tempfile.TemporaryDirectory(prefix='ghgflix-pages-') as temp:
        checkout = Path(temp).resolve()

        def git(*args):
            return subprocess.check_output(['git', *args], cwd=checkout, env=env, stderr=subprocess.STDOUT).decode()

        git('init')
        git('remote', 'add', 'origin', 'https://github.com/' + config['github_repository'] + '.git')
        if git('ls-remote', '--heads', 'origin', 'gh-pages').strip():
            git('fetch', '--depth=1', 'origin', 'gh-pages')
            git('checkout', '-b', 'gh-pages', 'FETCH_HEAD')
            marker = checkout / '.fdroid-publisher.json'
            if not marker.is_file() or json.loads(marker.read_text()) != {'publisher': 'GHGFlix F-Droid', 'fingerprint': config['fingerprint']}:
                raise ValueError('gh-pages is not owned by this publisher; existing files remain untouched')
            if any(p.name not in {'.git', '.nojekyll', '.fdroid-publisher.json', 'index.html', 'fdroid'} for p in checkout.iterdir()):
                raise ValueError('Unexpected files on gh-pages; refusing to overwrite manual content')
            for item in list(checkout.iterdir()):
                if item.name == '.git':
                    continue
                if item.is_symlink() or not item.resolve().is_relative_to(checkout):
                    raise ValueError('Unsafe existing publication path')
                if item.is_dir():
                    shutil.rmtree(item)
                else:
                    item.unlink()
        else:
            git('checkout', '--orphan', 'gh-pages')
        shutil.copytree(site, checkout, dirs_exist_ok=True)
        git('config', 'user.name', 'github-actions[bot]')
        git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com')
        git('add', '--all')
        git('commit', '-m', 'F-Droid repository from ' + source)
        # No force push, no write to main/web or any other branch.
        git('push', 'origin', 'HEAD:refs/heads/gh-pages')
    pages = api('pages')
    if pages.get('source') != {'branch': 'gh-pages', 'path': '/'} or pages.get('build_type') != 'legacy':
        raise ValueError('Configure Pages: Deploy from a branch, gh-pages, / (root), then rerun this deployment')
    # GITHUB_TOKEN pushes do not trigger Pages by themselves; request the build explicitly.
    api('pages/builds', '--method', 'POST')
    print('Published gh-pages snapshot and requested the GitHub Pages build')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('site', type=Path)
    deploy(parser.parse_args().site.resolve())
