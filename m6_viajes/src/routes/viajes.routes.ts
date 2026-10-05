import { Router } from 'express';
import { solicitarViaje, registrarArribo, asignarConductor, iniciarViaje } from '../controllers/viajes.controller.js';

const router = Router();
//en este archivo definimos las rutas del modulo de viajes, que serán consumidas por el cliente (app móvil) y por otros servicios (M3, M8). Cada ruta llama a un controlador que implementa la lógica de negocio correspondiente.
//endpoint para solicitar un viaje (RF-6.1)
router.post('/', solicitarViaje);

//endpoint para asignar conductor (RF-6.2)
router.post('/:id/asignar', asignarConductor);

//endpoint para validar código y iniciar viaje (RF-6.3)
router.post('/:id/iniciar', iniciarViaje);

//endpoint para registrar que el conductor llegó 
router.put('/:id/arribo', registrarArribo);

export default router;