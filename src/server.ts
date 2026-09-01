import { app } from './app.js';
import { env } from './config/env.js';
import { supabase } from './config/supabase.js';

void supabase;

app.listen(env.PORT, () => {
  console.log(`M9 – Reservas Programadas escuchando en el puerto ${env.PORT}.`);
});
