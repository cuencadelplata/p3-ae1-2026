export type TicketStatus = 'ABIERTO' | 'EN_PROCESO' | 'RESUELTO'
export type TicketOrder = 'asc' | 'desc'

export const ticketStateLabel: Record<TicketStatus, string> = {
  ABIERTO: 'Abierto',
  EN_PROCESO: 'En proceso',
  RESUELTO: 'Resuelto',
}

export interface SupportTicket {
  id: string
  tripId: string
  motivo: string
  estado: TicketStatus
  version: number
  fechaCreacion: string
}

export interface TicketChange {
  id: number
  estadoAnterior: TicketStatus | null
  estadoNuevo: TicketStatus
  cambiadoPor: string | null
  motivo: string | null
  fecha: string
}
