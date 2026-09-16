import { createM5StubApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);

createM5StubApp().listen(port, () => {
  console.log(`M5 stub escuchando en el puerto ${port}.`);
});
