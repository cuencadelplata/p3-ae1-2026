// representa un pago ya hecho, asi guarda y se puede ver si una misma orden intenta cobrar otra vez

export interface RegistroPago {
  idOrden: string;
  idViaje: string;
  monto: number;
  fecha: Date;
}