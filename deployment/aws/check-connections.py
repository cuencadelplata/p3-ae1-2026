"""Comprueba autenticacion externa sin enviar correo ni crear pagos."""
import json
import smtplib
import ssl
import urllib.request
import urllib.error
from pathlib import Path
env = dict(line.split('=',1) for line in Path(__file__).with_name('.env').read_text().splitlines() if '=' in line and not line.startswith('#'))
def check(name, url, headers):
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=20) as r:
            print(name, r.status)
    except urllib.error.HTTPError as e:
        print(name, e.code)
    except Exception as e:
        print(name, type(e).__name__)
check('Supabase M7',env['M7_SUPABASE_URL']+'/rest/v1/financial_operations?select=id&limit=0',{'apikey':env['M7_SUPABASE_KEY']})
check('Mercado Pago identidad','https://api.mercadopago.com/users/me',{'Authorization':'Bearer '+env['MP_ACCESS_TOKEN']})
try:
    with smtplib.SMTP_SSL(env['M8_SMTP_HOST'],int(env['M8_SMTP_PORT']),context=ssl.create_default_context(),timeout=20) as server:
        server.login(env['M8_SMTP_USER'],env['M8_SMTP_PASSWORD'])
    print('SMTP autenticacion OK; ningun correo enviado')
except Exception as e:
    print('SMTP',type(e).__name__)
