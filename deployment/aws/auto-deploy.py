"""Pull deployment: solo HEAD de AWS-CloudTest con CI propio aprobado."""
import fcntl
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

ROOT=Path('/home/ubuntu/movilidad-cd')
ROOT.mkdir(exist_ok=True,mode=0o700)
lock=(ROOT/'lock').open('w')
try:
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit('Otro despliegue esta en curso')
REPOSITORY='cuencadelplata/p3-ae1-2026'
API='https://api.github.com/repos/'+REPOSITORY
def get(path):
    req=urllib.request.Request(API+path,headers={'Accept':'application/vnd.github+json','User-Agent':'movilidad-cloudtest-cd'})
    with urllib.request.urlopen(req,timeout=30) as response:
        return json.load(response)
sha=get('/git/ref/heads/AWS-CloudTest')['object']['sha']
assert re.fullmatch('[a-f0-9]{40}',sha)
state=ROOT/'deployed-sha'
if state.exists() and state.read_text().strip()==sha:
    raise SystemExit('Sin cambios')
runs=get('/actions/workflows/aws-ci.yml/runs?branch=AWS-CloudTest&per_page=20')['workflow_runs']
matching=[r for r in runs if r['head_sha']==sha and r['event'] in ('push','workflow_dispatch')]
if not matching or matching[0]['status']!='completed' or matching[0]['conclusion']!='success':
    raise SystemExit('CI pendiente o fallido; no se despliega')
release=ROOT/'releases'/sha
release.parent.mkdir(exist_ok=True)
if not release.exists():
    subprocess.run(['git','clone','--depth','1','--branch','AWS-CloudTest','https://github.com/'+REPOSITORY+'.git',str(release)],check=True)
actual=subprocess.check_output(['git','-C',str(release),'rev-parse','HEAD'],text=True).strip()
if actual!=sha:
    raise SystemExit('La rama cambio durante la descarga; se reintentara')
envfile=release/'deployment/aws/.env'
if not envfile.exists():
    envfile.symlink_to('/home/ubuntu/movilidad/deployment/aws/.env')
env={**os.environ,'COMPOSE_PROFILES':'m3,observability'}
print('Desplegando',sha,flush=True)
subprocess.run(['bash','deployment/aws/deploy.sh','up'],cwd=release,env=env,check=True)
values=dict(line.split('=',1) for line in envfile.read_text().splitlines() if '=' in line and not line.startswith('#'))
for path in ('/','/identity/health'):
    with urllib.request.urlopen('https://'+values['APP_DOMAIN']+path,timeout=30) as response:
        if response.status!=200:
            raise RuntimeError('HTTPS no disponible')
state.write_text(sha+'\n')
current=ROOT/'current'
temporary=ROOT/'current-next'
temporary.unlink(missing_ok=True)
temporary.symlink_to(release,target_is_directory=True)
temporary.replace(current)
print('Despliegue y HTTPS OK',sha,flush=True)
