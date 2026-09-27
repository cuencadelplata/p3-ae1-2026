// Mock del servicio de QR (RF-8.2) y Comprobantes (RF-8.3)
export class DocumentServiceMock {
  static async generateQR(viajeId: string): Promise<string> {
    console.log(`[MOCK - DocumentService] Generando QR temporal para el inicio del viaje ${viajeId}...`);
    // A futuro se conectará con la librería real qrcode y la lógica del Grupo 6
    return `https://mock-storage.com/qr/${viajeId}.png`;
  }

  static async generatePDF(viajeId: string, importe: number): Promise<string> {
    console.log(`[MOCK - DocumentService] Generando comprobante PDF para el viaje ${viajeId} con importe $${importe}...`);
    return `https://mock-storage.com/pdf/${viajeId}.pdf`;
  }
}
