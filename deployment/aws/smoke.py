"""Prueba HTTPS con datos desechables; no imprime passwords ni tokens."""
import datetime
import json
import secrets
import urllib.request
import urllib.error
from pathlib import Path

env = dict(line.split('=', 1) for line in Path(__file__).with_name('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
base = 'https://' + env['APP_DOMAIN']
def request(path, method='GET', data=None, token=None, expected=(200,)):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + path, data=json.dumps(data).encode() if data is not None else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read()
    print(method, path, status)
    if status not in expected:
        raise RuntimeError('Respuesta inesperada; revisar logs privados del servicio')
    try:
        return json.loads(body)
    except ValueError:
        return None

request('/')
request('/identity/health')
request('/identity/auth/token-delegado', 'POST', {}, expected=(404,))
request('/flujo-api/m9/reservas', expected=(401,))
suffix = secrets.token_hex(5)
password = secrets.token_urlsafe(24)
email = 'aws-smoke-' + suffix + '@example.com'
user = request('/identity/auth/registrar-usuario', 'POST', {'nombre':'Prueba AWS','apellido':'Temporal','dni':str(secrets.randbelow(80000000)+10000000),'telefono':'3794000000','email':email,'password':password,'rol':'CLIENTE'}, expected=(201,))
login = request('/identity/auth/iniciar-sesion', 'POST', {'email':email,'password':password})
token = login.get('token') or login.get('access_token') or login.get('accessToken')
if not token:
    raise RuntimeError('Login no devolvio token')
request('/flujo-api/m9/reservas', token=token)
reservation = request('/flujo-api/m9/reservas', 'POST', {
    'origen':'Plaza 25 de Mayo, Corrientes, Argentina',
    'destino':'Parque Mitre, Corrientes, Argentina',
    'vehiculo':'AUTO',
    'fechaHoraProgramada':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=2)).isoformat(),
}, token=token, expected=(201,))
reservation_id = reservation['id']
try:
    request('/flujo-api/m9/reservas/' + reservation_id, token=token)
    request('/flujo-api/m9/reservas/' + reservation_id, 'PATCH', {
        'fechaHoraProgramada':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=3)).isoformat(),
    }, token=token)
    request('/flujo-api/m9/reservas', 'POST', {
        'origen':'A','destino':'B','vehiculo':'AUTO','fechaHoraProgramada':'2000-01-01T00:00:00Z',
    }, token=token, expected=(400,))
    second_email = 'aws-owner-check-' + suffix + '@example.com'
    request('/identity/auth/registrar-usuario','POST',{'nombre':'Prueba','apellido':'Propiedad','dni':str(secrets.randbelow(80000000)+10000000),'telefono':'3794000000','email':second_email,'password':password,'rol':'CLIENTE'},expected=(201,))
    second_login=request('/identity/auth/iniciar-sesion','POST',{'email':second_email,'password':password})
    second_token=second_login['token']
    for method,data in [('GET',None),('PATCH',{'vehiculo':'MOTO'}),('DELETE',None)]:
        request('/flujo-api/m9/reservas/'+reservation_id,method,data,second_token,expected=(403,404))
finally:
    request('/flujo-api/m9/reservas/' + reservation_id, 'DELETE', token=token)
print('HTTPS, bloqueo sin identidad y login M1 -> consulta M9: OK')
