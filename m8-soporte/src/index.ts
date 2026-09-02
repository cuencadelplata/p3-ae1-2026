import express from 'express';
import swaggerUi from 'swagger-ui-express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { SupportController } from './controllers/support.controller.js';
import { RabbitMQConsumer } from './rabbitmq/consumer.js';

const app = express();
app.use(express.json());

// Configuración de Swagger (OpenAPI)
const openapiPath = path.resolve(process.cwd(), 'openapi.yaml');
const fileContent = fs.readFileSync(openapiPath, 'utf8');
const swaggerDocument = YAML.parse(fileContent);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Ruta raíz (Estado del servicio)
app.get('/', (req, res) => {
  res.json({
    servicio: 'M8 - Soporte, Notificaciones y RabbitMQ',
    estado: 'ACTIVO',
    documentacion: '/api-docs',
    endpoints: [
      'POST /tickets',
      'GET /tickets',
      'GET /tickets/:id',
      'PATCH /tickets/:id/estado'
    ]
  });
});

// Endpoints RF-8.5 (Gestión de tickets de Soporte)
app.post('/tickets', SupportController.crearTicket);
app.get('/tickets/:id', SupportController.obtenerTicket);
app.patch('/tickets/:id/estado', SupportController.actualizarEstado);
app.get('/tickets', SupportController.listarTodos); // Para pruebas

const PORT = process.env.PORT || 3000;
const RABBIT_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

app.listen(PORT, async () => {
  console.log(`[Server] Microservicio M8-Soporte ejecutándose en puerto ${PORT}`);
  
  // Iniciamos el consumo asíncrono (RF-8.6)
  await RabbitMQConsumer.connect(RABBIT_URL);
});
