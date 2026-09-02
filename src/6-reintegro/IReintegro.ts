// Aylen
// registro de que se devolvió dinero a un cliente despues de cobrar un cargo de cancelacion

export interface IReintegro {
  id: string;
  idViaje: string;
  montoCancelacion: number; //comision de cancelacion
  montoReintegro: number;
  motivo: string; // texto libre (M6)
  fecha: Date;
}