const clientes = new Set();
const recientes = [];
const MAX_RECIENTES = 20;

function publicarNotificacion(evento) {
  recientes.unshift(evento);
  if (recientes.length > MAX_RECIENTES) {
    recientes.pop();
  }

  const cuerpo = `data: ${JSON.stringify(evento)}\n\n`;
  for (const respuesta of clientes) {
    respuesta.write(cuerpo);
  }
}

function listarNotificaciones() {
  return recientes;
}

function suscribir(respuesta) {
  clientes.add(respuesta);
  return () => clientes.delete(respuesta);
}

module.exports = {
  publicarNotificacion,
  listarNotificaciones,
  suscribir
};
