export type TipoPago= "efectivo" | "tarjeta"| "transferencia"; 
export type estadoPago= "pendiente"|"autorizado"| "rechazado";

export interface MetodoPago{
    pagoId: string;
    clienteId: string;
    viajeId: string; 
    tipo:TipoPago;
    detalle: string; //ej: digitos de tarjeta, alias 
    fecha: string; 
    estado: estadoPago; 
}