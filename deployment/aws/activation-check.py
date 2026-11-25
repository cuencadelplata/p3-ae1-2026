"""Activa una reserva real hasta M5, sin aceptar ofertas ni iniciar viajes."""
import time
import datetime
import smoke as api

reservation=api.request('/flujo-api/m9/reservas','POST',{
    'origen':'Plaza 25 de Mayo, Corrientes, Argentina',
    'destino':'Parque Mitre, Corrientes, Argentina','vehiculo':'AUTO',
    'fechaHoraProgramada':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=30)).isoformat(),
},token=api.token,expected=(201,))
print('Ruta resuelta:',bool(reservation.get('routeSnapshot')),'Tarifa positiva:',bool(reservation.get('tarifaEstimada',0) and reservation['tarifaEstimada']>0))
current=reservation
try:
    deadline=time.monotonic()+150
    while time.monotonic()<deadline:
        current=api.request('/flujo-api/m9/reservas/'+reservation['id'],token=api.token)
        print('Estado:',current['estado'],'Solicitud confirmada:',bool(current.get('idSolicitud')))
        if current.get('idSolicitud') or current['estado']=='FALLIDA': break
        time.sleep(5)
    if not current.get('idSolicitud'):
        raise RuntimeError('Activacion sin solicitud M5 confirmada: '+current['estado'])
    rid=current['idSolicitud']
    request=api.request('/flujo-api/m5/api/v1/ride-requests/'+rid,token=api.token)
    print('Solicitud M5 encontrada; estado:',request.get('status'))
    api.request('/flujo-api/m5/api/v1/ride-requests/'+rid+'/cancel','POST',{},api.token)
finally:
    if current['estado']=='PROGRAMADA':
        api.request('/flujo-api/m9/reservas/'+reservation['id'],'DELETE',token=api.token)
