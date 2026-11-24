import { Router } from 'express';
import { asociarViaje } from '../../observabilidad/logger.js';
import { solicitarViaje, obtenerViaje, cancelarViaje, finalizarViaje, obtenerHistorialTransiciones, registrarArribo, asignarConductor, iniciarViaje, listarRegistroViajes, } from '../controllers/viajes.controller.js';
const router = Router();
// Correlación (RNF-13): toda ruta con :id agrega el tripId a los logs y a la traza.
router.param('id', (_req, _res, next, id) => {
    asociarViaje(String(id));
    next();
});
//en este archivo definimos las rutas del modulo de viajes, que serán consumidas por el cliente (app móvil) y por otros servicios (M3, M8). Cada ruta llama a un controlador que implementa la lógica de negocio correspondiente.
//endpoint para solicitar un viaje (RF-6.1)
router.post('/', solicitarViaje);
//registro de viajes filtrable por cliente, conductor y estado (RF-6.7)
router.get('/', listarRegistroViajes);
//endpoints de compatibilidad para RF-6.5 y RF-6.6
router.get('/:id', obtenerViaje);
router.patch('/:id/cancelacion', cancelarViaje);
router.post('/:id/finalizacion', finalizarViaje);
router.get('/:id/historial-transiciones', obtenerHistorialTransiciones);
//endpoint para asignar conductor (RF-6.2)
router.post('/:id/asignar', asignarConductor);
router.patch('/:id/asignar', asignarConductor);
//endpoint para validar código y iniciar viaje (RF-6.3)
router.post('/:id/iniciar', iniciarViaje);
//endpoint para registrar que el conductor llegó 
router.put('/:id/arribo', registrarArribo);
export default router;
