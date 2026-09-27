const form = document.querySelector("#notification-form");
const submitButton = document.querySelector("#submit-button");
const result = document.querySelector("#result");
const previewEmpty = document.querySelector("#preview-empty");
const submitLabel = submitButton.textContent;
const qrGenerationForm = document.querySelector("#qr-generation-form");
const generateQrButton = document.querySelector("#generate-qr-button");
const validateQrButton = document.querySelector("#validate-qr-button");
const reuseQrButton = document.querySelector("#reuse-qr-button");
const qrImage = document.querySelector("#qr-image");
const qrEmpty = document.querySelector("#qr-empty");
const qrMetadata = document.querySelector("#qr-metadata");
const qrExpiresAt = document.querySelector("#qr-expires-at");
const qrCountdown = document.querySelector("#qr-countdown");
const qrResult = document.querySelector("#qr-result");
let hasProcessedNotification = false;
let qrToken = null;
let qrTripId = null;
let qrTimer = null;
const eventLabels = {
  TRIP_REQUESTED: "Solicitud de viaje",
  DRIVER_ASSIGNED: "Conductor asignado",
  DRIVER_ARRIVED: "Conductor llegó",
  TRIP_STARTED: "Viaje iniciado",
  TRIP_CANCELLED: "Viaje cancelado",
  TRIP_COMPLETED: "Viaje finalizado",
};

function createTextElement(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

function showResult(kind, title, content) {
  result.className = `result ${kind}`;
  result.hidden = false;
  previewEmpty.hidden = true;
  result.replaceChildren(createTextElement("h3", title), content);
}

function createDetails(items) {
  const details = document.createElement("dl");

  for (const [label, value] of items) {
    details.append(createTextElement("dt", label), createTextElement("dd", String(value)));
  }

  return details;
}

function showSuccess(notification) {
  const content = document.createElement("div");
  const preview = document.createElement("section");
  const channel = notification.channels.join(", ");
  const details = document.createElement("details");

  preview.className = "notification-preview";
  preview.append(
    createTextElement("p", "M8 · Ahora"),
    createTextElement("h3", eventLabels[notification.eventType] ?? notification.eventType),
    createTextElement("p", notification.message),
    createTextElement("p", `${channel} · Vista previa simulada en AE1`),
  );

  details.className = "technical-details";
  details.append(
    createTextElement("summary", "Ver detalles técnicos"),
    createDetails([
      ["Notification ID", notification.notificationId],
      ["Trip ID", notification.tripId],
      ["Recipient ID", notification.recipientId],
      ["Evento técnico", notification.eventType],
      ["Canal", channel],
      ["Estado", notification.status],
      ["Creada", notification.createdAt],
    ]),
  );

  content.append(preview, details);
  showResult("success", "Notificación procesada por M8", content);
  hasProcessedNotification = true;
}

function invalidatePreviewIfNeeded(event) {
  const fieldName = event.target.name;

  if (!hasProcessedNotification || !["tripId", "recipientId", "eventType"].includes(fieldName)) return;

  hasProcessedNotification = false;
  result.hidden = true;
  previewEmpty.textContent = "Hay cambios sin procesar. Procesá el evento en M8 para actualizar la vista previa.";
  previewEmpty.hidden = false;
}

function showNotificationError(error) {
  const content = document.createElement("div");
  const items = [];

  if (error.code) items.push(["Código", error.code]);
  if (error.message) items.push(["Mensaje", error.message]);
  if (items.length > 0) content.append(createDetails(items));

  if (Array.isArray(error.details) && error.details.length > 0) {
    const list = document.createElement("ul");
    for (const detail of error.details) {
      list.append(createTextElement("li", `${detail.field}: ${detail.reason}`));
    }
    content.append(list);
  }

  showResult("error", "No se pudo procesar la notificación", content);
}

function showQrResult(kind, title, messages) {
  qrResult.className = `result ${kind}`;
  qrResult.hidden = false;
  qrResult.replaceChildren(
    createTextElement("h4", title),
    ...messages.map((message) => createTextElement("p", message)),
  );
}

function stopQrTimer() {
  if (qrTimer !== null) {
    clearInterval(qrTimer);
    qrTimer = null;
  }
}

function updateQrCountdown(expiresAt) {
  const remainingMilliseconds = new Date(expiresAt).getTime() - Date.now();

  if (remainingMilliseconds <= 0) {
    stopQrTimer();
    qrCountdown.textContent = "QR EXPIRADO";
    validateQrButton.disabled = true;
    validateQrButton.textContent = "QR expirado";
    showQrResult("error", "QR EXPIRADO", ["El backend mantiene la autoridad sobre la expiración del QR."]);
    return;
  }

  const remainingSeconds = Math.ceil(remainingMilliseconds / 1000);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  qrCountdown.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resetQrDemo() {
  stopQrTimer();
  qrToken = null;
  qrTripId = null;
  qrImage.removeAttribute("src");
  qrImage.hidden = true;
  qrEmpty.hidden = false;
  qrMetadata.hidden = true;
  qrExpiresAt.textContent = "";
  qrCountdown.textContent = "--:--";
  qrResult.hidden = true;
  validateQrButton.disabled = true;
  validateQrButton.textContent = "Validar QR";
  reuseQrButton.hidden = true;
  reuseQrButton.textContent = "Probar reutilización";
}

function formatQrError(error) {
  const messagesByCode = {
    QR_ALREADY_USED: "QR ya utilizado",
    QR_EXPIRED: "QR expirado",
    QR_NOT_FOUND: "QR no encontrado o no corresponde al viaje",
  };

  if (error.code && messagesByCode[error.code]) return messagesByCode[error.code];
  if (error.message) return error.message;
  return "No fue posible procesar la solicitud QR.";
}

async function readResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  const formData = new FormData(form);
  const requestBody = {
    tripId: formData.get("tripId"),
    recipientId: formData.get("recipientId"),
    eventType: formData.get("eventType"),
    channels: ["PUSH"],
  };

  submitButton.disabled = true;
  submitButton.textContent = "Enviando...";
  hasProcessedNotification = false;
  result.hidden = true;
  previewEmpty.hidden = false;

  try {
    const response = await fetch("/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await readResponse(response);

    if (response.status === 201) {
      showSuccess(responseBody);
    } else {
      showNotificationError(responseBody.error ?? {});
    }
  } catch {
    showNotificationError({ message: "No fue posible comunicarse con el servicio. Intente nuevamente." });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
  }
});

qrGenerationForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!qrGenerationForm.reportValidity()) return;

  const tripId = new FormData(qrGenerationForm).get("tripId");
  resetQrDemo();
  generateQrButton.disabled = true;
  generateQrButton.textContent = "Generando...";

  try {
    const response = await fetch("/qr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId }),
    });
    const responseBody = await readResponse(response);

    if (response.status !== 201) {
      showQrResult("error", "No se pudo generar el QR", [formatQrError(responseBody.error ?? {})]);
      return;
    }

    qrToken = responseBody.token;
    qrTripId = tripId;
    qrImage.src = responseBody.qrDataUrl;
    qrImage.hidden = false;
    qrEmpty.hidden = true;
    qrExpiresAt.dateTime = responseBody.expiresAt;
    qrExpiresAt.textContent = new Date(responseBody.expiresAt).toLocaleString();
    qrMetadata.hidden = false;
    validateQrButton.disabled = false;
    updateQrCountdown(responseBody.expiresAt);
    qrTimer = setInterval(() => updateQrCountdown(responseBody.expiresAt), 1000);
    showQrResult("success", "QR generado por M8", ["El QR contiene un token opaco y temporal."]);
  } catch {
    showQrResult("error", "No se pudo generar el QR", ["No fue posible comunicarse con el servicio."]);
  } finally {
    generateQrButton.disabled = false;
    generateQrButton.textContent = "Generar QR";
  }
});

async function validateQr(isReuseAttempt) {
  if (!qrToken || !qrTripId) return;

  const activeButton = isReuseAttempt ? reuseQrButton : validateQrButton;
  activeButton.disabled = true;
  activeButton.textContent = "Validando...";

  try {
    const response = await fetch("/qr/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tripId: qrTripId, token: qrToken }),
    });
    const responseBody = await readResponse(response);

    if (response.status === 200) {
      stopQrTimer();
      qrCountdown.textContent = "CONSUMIDO";
      validateQrButton.disabled = true;
      validateQrButton.textContent = "QR consumido";
      reuseQrButton.hidden = false;
      reuseQrButton.disabled = false;
      showQrResult("success", "QR VÁLIDO", [
        "Validación completada por M8.",
        "Estado del QR: CONSUMIDO. El QR fue consumido y no puede volver a utilizarse.",
        "El módulo responsable del ciclo de vida del viaje decidirá el siguiente paso.",
      ]);
      return;
    }

    const message = formatQrError(responseBody.error ?? {});
    if (responseBody.error?.code === "QR_ALREADY_USED") {
      validateQrButton.disabled = true;
      reuseQrButton.hidden = false;
    }
    if (responseBody.error?.code === "QR_EXPIRED") {
      stopQrTimer();
      validateQrButton.disabled = true;
      validateQrButton.textContent = "QR expirado";
    }
    showQrResult("error", message, ["La validación fue rechazada por M8."]);
  } catch {
    showQrResult("error", "No se pudo validar el QR", ["No fue posible comunicarse con el servicio."]);
  } finally {
    if (isReuseAttempt) {
      reuseQrButton.disabled = false;
      reuseQrButton.textContent = "Probar reutilización";
    } else if (!validateQrButton.disabled) {
      validateQrButton.textContent = "Validar QR";
    }
  }
}

form.addEventListener("input", invalidatePreviewIfNeeded);
form.addEventListener("change", invalidatePreviewIfNeeded);
validateQrButton.addEventListener("click", () => validateQr(false));
reuseQrButton.addEventListener("click", () => validateQr(true));
