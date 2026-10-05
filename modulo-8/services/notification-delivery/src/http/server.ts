import http from 'node:http';
import { createApp } from './app.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3107;

const server = http.createServer(createApp());

server.listen(PORT, () => {
  console.log(`[RF8.7] Servicio de Entrega de Notificaciones escuchando en http://localhost:${PORT}`);
});
