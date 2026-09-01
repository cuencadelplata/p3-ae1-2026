const form = document.querySelector("#notification-form");
const submitButton = document.querySelector("#submit-button");
const result = document.querySelector("#result");
const previewEmpty = document.querySelector("#preview-empty");
const submitLabel = submitButton.textContent;
let hasProcessedNotification = false;
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

  showResult(
    "success",
    "Notificación procesada por M8",
    content,
  );
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

function showError(error) {
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
    const responseBody = await response.json();

    if (response.status === 201) {
      showSuccess(responseBody);
    } else {
      showError(responseBody.error ?? {});
    }
  } catch {
    showError({ message: "No fue posible comunicarse con el servicio. Intente nuevamente." });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = submitLabel;
  }
});

form.addEventListener("input", invalidatePreviewIfNeeded);
form.addEventListener("change", invalidatePreviewIfNeeded);
