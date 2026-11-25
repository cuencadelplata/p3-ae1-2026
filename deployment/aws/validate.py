"""Valida el Compose efectivo sin imprimir secretos ni iniciar servicios."""
import json
import sys

def validate(config):
    services = config['services']
    for name, service in services.items():
        if name != 'caddy' and service.get('ports'):
            raise ValueError(f'{name}: tiene puertos publicados fuera del proxy')
    m1 = services['m1-identidad-acceso']['environment']
    m9 = services['m9-reservas']['environment']
    m5 = services['m5-dispatch-service']['environment']
    m4 = services['m4-api']['environment']
    if m1.get('NODE_ENV') != 'production' or m5.get('AUTH_MODE') != 'jwt' or m9.get('M9_AUTH_MODE') != 'm1':
        raise ValueError('La autenticación real debe estar habilitada')
    if m4.get('SKIP_AUTH_VALIDATION') != 'false' or m9.get('ROUTE_RESOLVER_MODE') != 'm4':
        raise ValueError('M4 debe resolver rutas reales y validar identidad')
    if len(m1.get('JWT_SECRET', '')) < 32 or m1['JWT_SECRET'] != m5.get('JWT_SECRET'):
        raise ValueError('M1 y M5 requieren una clave JWT privada coincidente de al menos 32 caracteres')
    credential = m9.get('M9_DISPATCH_AUTH_TOKEN', '')
    if len(credential) < 32 or credential != m1.get('DELEGACION_M9_CREDENCIAL'):
        raise ValueError('Falta una credencial de delegación coincidente entre M1 y M9')
    required = {'m7-api': ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_KEY', 'MP_ACCESS_TOKEN'],
                'm8-app': ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']}
    if 'm3-conductor-api' in services:
        required['m3-conductor-api'] = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
    smtp = services['m8-app']['environment']
    if any(smtp.get(key) for key in ['SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM']):
        required['m8-app'] += ['SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM']
    for name, keys in required.items():
        for key in keys:
            if not services[name]['environment'].get(key):
                raise ValueError(f'Completar la credencial privada {name}/{key} en deployment/aws/.env')
    for name in ['m9-reservas', 'm5-dispatch-service', 'm6-viajes-app', 'm8-app']:
        for key, value in services[name].get('environment', {}).items():
            if key in ['M7_URL', 'M7_BASE_URL', 'M7_PAYMENTS_URL'] and value != 'http://m7-api:3000':
                raise ValueError(f'{name}/{key}: debe usar M7 real')
    api_url = services['m1-ui']['build']['args']['VITE_API_URL']
    if not api_url.startswith('https://') or not api_url.endswith('/identity') or 'localhost' in api_url:
        raise ValueError('El frontend requiere una URL HTTPS pública para M1')

if __name__ == '__main__':
    try:
        validate(json.load(sys.stdin))
        print('Validación: puertos privados, JWT, delegación, rutas y servicios reales configurados.')
    except (ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
