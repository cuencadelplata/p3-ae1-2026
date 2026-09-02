import { RegistroPago } from "../5-pago-duplicado/IRegistroPago";

// simulan pagos ya procesados, para probar la verificación de duplicados

export const registrosDeEjemplo: RegistroPago[] = [
  {
    idOrden: "o1",
    idViaje: "v1",
    monto: 5000,
    fecha: new Date("20-08-26"),
  },
  {
    idOrden: "o2",
    idViaje: "v2",
    monto: 4530,
    fecha: new Date("20-08-26"),
  },
];