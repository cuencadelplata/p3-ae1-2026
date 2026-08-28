import express from 'express';
import type { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/viajes', (req: Request, res: Response) => {
    res.json({ mensaje: 'Módulo 6 de viajes inicializado correctamente' });
});

app.listen(PORT, () => {
    console.log(`Servidor del módulo corriendo en http://localhost:${PORT}`);
});