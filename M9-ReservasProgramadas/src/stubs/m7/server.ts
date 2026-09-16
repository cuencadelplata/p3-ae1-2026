import { createM7StubApp } from './app.js';

const port = Number(process.env.PORT ?? 3002);

createM7StubApp().listen(port, () => {
  console.log(`M7 stub escuchando en el puerto ${port}.`);
});
