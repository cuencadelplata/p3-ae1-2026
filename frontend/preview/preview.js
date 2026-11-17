import { createM8Feature } from '../m8.js';
import { api, hasBearerToken, setBearerToken } from '../api.js';

const page = document.querySelector('#page');
const dialog = document.querySelector('#auth-dialog');
const toast = document.querySelector('#toast');
let timer;
function notify(message, kind = 'ok') {
  toast.textContent = message;
  toast.className = `toast show ${kind}`;
  clearTimeout(timer);
  timer = setTimeout(() => { toast.className = 'toast'; }, 4800);
}
const feature = createM8Feature({ page, api, notify, hasSession: hasBearerToken });
function render() {
  const section = location.hash.slice(1) || 'comprobantes';
  feature.show(section);
  document.querySelectorAll('[data-page]').forEach(a => a.classList.toggle('active', a.dataset.page === section));
  document.querySelector('.sidebar').classList.remove('open');
}
document.querySelector('#account-button').addEventListener('click', () => {
  document.querySelector('#auth-token').value = '';
  dialog.showModal();
});
document.querySelector('#auth-form').addEventListener('submit', (event) => {
  if (event.submitter?.value === 'cancel') return;
  setBearerToken(document.querySelector('#auth-token').value);
  document.querySelector('#auth-token').value = '';
  feature.reset();
  notify(hasBearerToken() ? 'Token cargado para esta sesión.' : 'Se quitó el token.');
});
document.querySelector('#auth-clear').addEventListener('click', () => {
  setBearerToken('');
  document.querySelector('#auth-token').value = '';
  dialog.close();
  feature.reset();
  notify('Token quitado de esta sesión.');
});
document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
document.querySelector('#today').textContent = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date());
window.addEventListener('hashchange', render);
render();
