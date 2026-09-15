//aca se define el contrato (interfaz)
//dice cualquier cosa que quiera ser un proveedor PUSH tiene que tener un método SEND
//los datos que le llegan son recipientId y message

export interface PushNotificationPayload {
  recipientId: string;
  message: string;
}

export interface PushProvider {
  send(payload: PushNotificationPayload): Promise<void>;
}
