// Mock del servicio de Notificaciones (RF-8.1)
export class NotificationServiceMock {
  static async sendNotification(viajeId: string, tipo: string, mensaje: string): Promise<void> {
    console.log(`[MOCK - NotificationService] Enviando notificación para viaje ${viajeId}: [${tipo}] ${mensaje}`);
    // Aquí a futuro se importará el verdadero NotificationService de los compañeros (Grupo 6)
  }
}
