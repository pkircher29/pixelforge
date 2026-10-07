"""Verify the live harness using loopback fixtures and dummy credentials only."""
import argparse, subprocess, os, re, json, tempfile, pathlib, time, urllib.request
root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True, help='Path to the built pf-ai live example')
exe = str(pathlib.Path(parser.parse_args().binary).resolve())
server = subprocess.Popen(['node', str(root/'scripts/fake-ai-server.mjs'), '--port', '0', '--delay', '150', '--size', '64'], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
try:
    line = server.stdout.readline()
    base = re.search(r'http://127\.0\.0\.1:\d+', line).group()
    env = dict(os.environ)
    for suffix in ['OPENAI','XAI','GEMINI']:
        env['PF_AI_BASE_URL_'+suffix] = base
        env['PF_'+suffix+'_KEY'] = 'fixture-key-not-a-real-secret'
    evidence = root / 'live-results'
    evidence.mkdir(exist_ok=True)
    directory = pathlib.Path(tempfile.mkdtemp(prefix='harness-fixtures-', dir=evidence))
    def served():
        return json.load(urllib.request.urlopen(base+'/healthz'))['served']
    def run(name, args, expected=0, use_env=None):
        out = directory/name
        result = subprocess.run([exe, *args, '--out', str(out)], env=use_env or env, capture_output=True, text=True, timeout=60)
        assert result.returncode == expected, (name, result.stdout, result.stderr)
        report = json.loads((out/'report.json').read_text()) if (out/'report.json').exists() else None
        if report:
            assert not report['all_three_vendor_images_verified']
            assert 'fixture-key-not-a-real-secret' not in json.dumps(report)
        print(name, 'PASS', flush=True)
        return out, report
    before = served()
    _, report = run('metadata', ['--all', '--check-only'])
    assert report['mode'] == 'metadata_only' and report['success']
    assert all(r['image_request'] == 'not_run' for r in report['providers'])
    assert served() == before
    generated, report = run('generate', ['--all', '--prompt', 'local harness fixture'])
    assert len(report['providers']) == 3 and report['success']
    assert all((generated/r['artifacts'][0]['file']).stat().st_size > 0 for r in report['providers'])
    _, report = run('edit', ['--all', '--edit', str(generated/'open_ai_1.png')])
    assert report['mode'] == 'instruct_edit' and report['success']
    _, report = run('quota', ['--all', '--prompt', '!quota'], 1)
    assert all(r['error_code']=='ai_quota' and r['failed_stage']=='image_request' for r in report['providers'])
    absent = dict(env)
    for suffix in ['OPENAI','XAI','GEMINI']: absent.pop('PF_'+suffix+'_KEY')
    before = served()
    _, report = run('missing', ['--all'], 1, absent)
    assert all(r['error_code']=='missing_key' for r in report['providers'])
    run('invalid-option', ['--all', '--unknown'], 2)
    assert served() == before
    bad = dict(env); bad['PF_OPENAI_KEY']='bad-fixture'
    _, report = run('auth', ['--provider', 'open_ai'], 1, bad)
    assert report['providers'][0]['failed_stage']=='authentication'
    # Force a real artifact-write error after preflight, while the fixture is delayed.
    out = directory/'write-failure'
    proc = subprocess.Popen([exe, '--provider', 'open_ai', '--out', str(out)], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for _ in range(1000):
        if out.exists(): break
        time.sleep(.001)
    (out/'open_ai_1.png').mkdir()
    stdout, stderr = proc.communicate(timeout=60)
    assert proc.returncode == 1, (stdout, stderr)
    report = json.loads((out/'report.json').read_text())
    assert report['providers'][0]['failed_stage']=='save' and not report['success']
    print('write-failure PASS', flush=True)
    # Existing evidence must be preserved before requests.
    previous = (generated/'report.json').read_bytes()
    result = subprocess.run([exe, '--all', '--out', str(generated)], env=env, capture_output=True, timeout=20)
    assert result.returncode == 2 and (generated/'report.json').read_bytes() == previous
    print('existing-output PASS', flush=True)
    print('Reports:', directory, flush=True)
finally:
    server.terminate()
    server.communicate(timeout=10)
