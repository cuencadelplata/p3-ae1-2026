/**
 * Módulo 2 - Clientes (Grupo 5)
 * Paradigmas de Programación III - AE1
 */

export const SERVICE_NAME = 'm2-clientes-api';
export const VERSION = '1.0.0';

export function getServiceInfo() {
  return {
    service: SERVICE_NAME,
    version: VERSION,
    status: 'ONLINE',
    timestamp: new Date().toISOString()
  };
}
