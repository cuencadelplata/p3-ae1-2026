export const VEHICLE_TYPES = ['AUTO', 'MOTO'] as const;
export const PAYMENT_METHODS = ['EFECTIVO', 'TARJETA', 'BILLETERA'] as const;
export const PAYMENT_STATUSES = ['APROBADO', 'PENDIENTE', 'RECHAZADO'] as const;
export const DELIVERY_CHANNELS = ['EMAIL', 'SMS', 'PUSH'] as const;

export type VehicleType = (typeof VEHICLE_TYPES)[number];
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

export interface Customer {
  id: string;
  fullName: string;
  email?: string;
  documentId?: string;
}

export interface Vehicle {
  type: VehicleType;
  plate: string;
  model?: string;
}

export interface Driver {
  id: string;
  fullName: string;
  vehicle: Vehicle;
}

export interface TripDetail {
  origin: string;
  destination: string;
  startedAt: string;
  finishedAt: string;
  distanceKm: number;
  durationMin: number;
}

export interface Fare {
  currency: string;
  baseFare: number;
  distanceAmount: number;
  timeAmount: number;
  surcharges: number;
  discounts: number;
  total: number;
}

export interface Payment {
  method: PaymentMethod;
  status: PaymentStatus;
  authorizationCode?: string;
}

/** Contrato de entrada: lo que M6 (viaje finalizado) y M7 (tarifa/pago) envian a M8. */
export interface ReceiptRequest {
  tripId: string;
  issuedAt?: string;
  customer: Customer;
  driver: Driver;
  trip: TripDetail;
  fare: Fare;
  payment: Payment;
}

/** Registro de cada entrega/reenvio del comprobante (RF-8.4). */
export interface DeliveryRecord {
  channel: DeliveryChannel;
  destination: string;
  sentAt: string;
}

/** Comprobante emitido y persistido por el servicio. */
export interface Receipt {
  receiptId: string;
  receiptNumber: string;
  tripId: string;
  issuedAt: string;
  customer: Customer;
  driver: Driver;
  trip: TripDetail;
  fare: Fare;
  payment: Payment;
  deliveries: DeliveryRecord[];
}
