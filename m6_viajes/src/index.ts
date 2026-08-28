import express from 'express';
import viajesRoutes from './routes/viajes.routes.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Enlazamos las rutas del modulo
app.use('/api/viajes', viajesRoutes);

app.listen(PORT, () => {
    console.log(`Servidor del modulo corriendo en http://localhost:${PORT}`);
});