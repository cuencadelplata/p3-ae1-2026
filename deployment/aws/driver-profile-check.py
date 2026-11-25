"""Comprueba alta pendiente y permisos sin habilitar conductores."""
import smoke as api
import secrets
suffix=secrets.token_hex(5)
email='aws-driver-'+suffix+'@example.com'
password=secrets.token_urlsafe(24)
api.request('/identity/auth/registrar-usuario','POST',{
    'nombre':'Prueba AWS','apellido':'Conductor','dni':str(secrets.randbelow(80000000)+10000000),
    'telefono':'3794000000','email':email,'password':password,'rol':'CONDUCTOR',
},expected=(201,))
login=api.request('/identity/auth/iniciar-sesion','POST',{'email':email,'password':password})
token=login['token']
profile=api.request('/flujo-api/m3/api/conductores/me','POST',{},token,expected=(200,201))
assert not profile.get('habilitado'), 'El perfil nuevo no debe estar aprobado'
api.request('/flujo-api/m3/api/conductores/me','POST',{},token,expected=(200,201))
api.request('/flujo-api/m3/api/conductores/pendientes',token=api.token,expected=(403,))
print('Alta repetible de conductor y bloqueo de aprobaciones para CLIENTE: OK')
