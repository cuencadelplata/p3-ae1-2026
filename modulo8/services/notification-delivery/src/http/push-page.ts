/**
 * Página para que un usuario de M1 active las notificaciones push de M8 en su
 * navegador (RF-8.7). Inicia sesión contra M1, registra el service worker,
 * suscribe el navegador con la clave VAPID pública de M8 y guarda la
 * suscripción como dispositivo WEB en POST /devices/tokens.
 */
export const PUSH_SERVICE_WORKER = `self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Movilidad Urbana';
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.notificationId || undefined,
      data,
    });
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const page of pages) page.postMessage({ type: 'push', title, body: data.body || '', receivedAt: new Date().toISOString() });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const path = self.location.pathname === '/push/app-sw.js' ? '/' : '/push';
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = pages.find((client) => new URL(client.url).pathname === path);
    if (page) return page.focus();
    return self.clients.openWindow(path);
  })());
});
`;

export function renderPushPage(options: { vapidPublicKey?: string; m1PublicUrl: string }): string {
  const config = JSON.stringify({ vapidPublicKey: options.vapidPublicKey ?? null, m1Url: options.m1PublicUrl })
    .replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Notificaciones M8</title>
<style>
  :root { --bg:#f5f6f8; --card:#fff; --text:#1f2933; --muted:#616e7c; --line:#d9dee4; --accent:#1d4ed8; --ok:#15803d; --err:#b91c1c; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12161c; --card:#1b2129; --text:#e6e9ee; --muted:#9aa5b1; --line:#2d3540; --accent:#6d93ff; --ok:#4ade80; --err:#f87171; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width:520px; margin:40px auto; padding:0 16px; }
  h1 { font-size:22px; margin:0 0 4px; }
  p.lead { margin:0 0 20px; color:var(--muted); }
  section { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:14px; }
  h2 { font-size:15px; margin:0 0 12px; }
  label { display:block; font-size:13px; color:var(--muted); margin:10px 0 4px; }
  input { width:100%; padding:9px 10px; border:1px solid var(--line); border-radius:7px; background:transparent; color:var(--text); font:inherit; }
  button { margin-top:14px; padding:9px 14px; border:0; border-radius:7px; background:var(--accent); color:#fff; font:inherit; cursor:pointer; }
  button:disabled { opacity:.5; cursor:default; }
  button.secondary { background:transparent; color:var(--accent); border:1px solid var(--line); margin-left:6px; }
  .status { margin-top:12px; font-size:14px; min-height:1.5em; }
  .ok { color:var(--ok); } .err { color:var(--err); }
  ul { list-style:none; margin:0; padding:0; }
  li { border-top:1px solid var(--line); padding:10px 0; }
  li:first-child { border-top:0; }
  li small { color:var(--muted); display:block; }
  .hidden { display:none; }
</style>
</head>
<body>
<main>
  <h1>Notificaciones del viaje</h1>
  <p class="lead">Iniciá sesión con tu cuenta y activá los avisos de M8 en este navegador.</p>

  <section id="login">
    <h2>1. Iniciar sesión</h2>
    <form id="login-form">
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" required>
      <label for="password">Contraseña</label>
      <input id="password" type="password" autocomplete="current-password" required>
      <button type="submit">Ingresar</button>
    </form>
    <div class="status" id="login-status"></div>
  </section>

  <section id="activate" class="hidden">
    <h2>2. Activar notificaciones</h2>
    <p id="user-line"></p>
    <button id="enable">Activar en este navegador</button>
    <button id="test" class="secondary" disabled>Enviar aviso de prueba</button>
    <button id="disable" class="secondary">Desactivar en este navegador</button>
    <div class="status" id="push-status"></div>
  </section>

  <section>
    <h2>Avisos recibidos</h2>
    <ul id="received"><li><small>Todavía no llegó ninguno.</small></li></ul>
  </section>
</main>
<script>
const config = ${config};
let session = null;
const $ = (id) => document.getElementById(id);
const setStatus = (id, text, kind) => { const el = $(id); el.textContent = text; el.className = 'status ' + (kind || ''); };

// Espera a que el service worker recién registrado quede activo.
function workerActivo(registration) {
  if (registration.active) return Promise.resolve();
  const worker = registration.installing || registration.waiting;
  return new Promise((resolve, reject) => {
    if (!worker) return reject(new Error('No se pudo instalar el service worker.'));
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') resolve();
      if (worker.state === 'redundant') reject(new Error('No se pudo instalar el service worker.'));
    });
  });
}

function keyToBytes(base64) {
  const padded = (base64 + '='.repeat((4 - base64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('login-status', 'Ingresando...');
  try {
    const login = await fetch(config.m1Url + '/auth/iniciar-sesion', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('email').value, password: $('password').value }),
    });
    const body = await login.json().catch(() => ({}));
    if (!login.ok || !body.token) throw new Error(body.error || body.message || 'M1 rechazó el ingreso');
    const identity = await fetch(config.m1Url + '/auth/validar-identidad-y-rol', { headers: { authorization: 'Bearer ' + body.token } });
    const who = await identity.json().catch(() => ({}));
    session = { token: body.token, userId: who.userId, role: who.role };
    setStatus('login-status', 'Sesión iniciada.', 'ok');
    $('user-line').textContent = 'Usuario N.º ' + (who.userId ?? '-') + (who.role ? ' (' + who.role + ')' : '');
    $('activate').classList.remove('hidden');
  } catch (error) {
    setStatus('login-status', error.message, 'err');
  }
});

$('enable').addEventListener('click', async () => {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Este navegador no admite notificaciones push.');
    if (!config.vapidPublicKey) throw new Error('M8 no tiene configuradas las claves VAPID.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('No se dio permiso para mostrar notificaciones.');
    setStatus('push-status', 'Activando...');
    const registration = await navigator.serviceWorker.register('/push/sw.js', { scope: '/push' });
    await workerActivo(registration);
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(config.vapidPublicKey) });
    }
    const saved = await fetch('/devices/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + session.token },
      body: JSON.stringify({ token: JSON.stringify(subscription), platform: 'WEB' }),
    });
    if (!saved.ok) throw new Error('M8 no pudo registrar el navegador (HTTP ' + saved.status + ').');
    setStatus('push-status', 'Notificaciones activadas en este navegador.', 'ok');
    $('test').disabled = false;
  } catch (error) {
    setStatus('push-status', error.message, 'err');
  }
});

$('test').addEventListener('click', async () => {
  const response = await fetch('/devices/tokens/test', { method: 'POST', headers: { authorization: 'Bearer ' + session.token } });
  const body = await response.json().catch(() => ({}));
  if (response.ok) setStatus('push-status', 'Aviso de prueba enviado.', 'ok');
  else setStatus('push-status', (body.error && body.error.message) || ('HTTP ' + response.status), 'err');
});

$('disable').addEventListener('click', async () => {
  try {
    const registration = await navigator.serviceWorker.getRegistration('/push');
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      const token = encodeURIComponent(JSON.stringify(subscription));
      const response = await fetch('/devices/tokens/' + token, {
        method: 'DELETE', headers: { authorization: 'Bearer ' + session.token },
      });
      if (!response.ok) throw new Error('M8 no pudo desactivar este navegador (HTTP ' + response.status + ').');
      await subscription.unsubscribe();
    }
    $('test').disabled = true;
    setStatus('push-status', 'Notificaciones desactivadas en este navegador.', 'ok');
  } catch (error) {
    setStatus('push-status', error.message, 'err');
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'push') return;
    const list = $('received');
    if (list.querySelector('small') && list.children.length === 1 && !list.children[0].dataset.item) list.innerHTML = '';
    const item = document.createElement('li');
    item.dataset.item = '1';
    const title = document.createElement('strong');
    title.textContent = event.data.title;
    const body = document.createElement('div');
    body.textContent = event.data.body;
    const time = document.createElement('small');
    time.textContent = new Date(event.data.receivedAt).toLocaleTimeString();
    item.append(title, body, time);
    list.prepend(item);
  });
}
</script>
</body>
</html>`;
}
