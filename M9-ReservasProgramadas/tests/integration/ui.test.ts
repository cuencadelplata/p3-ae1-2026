import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '../../src/app.js';

describe('UI de reservas', () => {
  it('sirve la pantalla principal y sus recursos estáticos', async () => {
    const page = await request(app).get('/');
    const styles = await request(app).get('/styles.css');
    const script = await request(app).get('/app.js');

    expect(page.status).toBe(200);
    expect(page.text).toContain('Nueva reserva');
    expect(page.text).toContain('Mis reservas');
    expect(page.text).toContain('id="session-form"');
    expect(page.text).toContain('id="reservation-fields" disabled');
    expect(styles.status).toBe(200);
    expect(styles.type).toMatch(/css/);
    expect(script.status).toBe(200);
    expect(script.type).toMatch(/javascript/);
  });

  it('sirve la tipografía local sin depender de un proveedor externo', async () => {
    const font = await request(app).get('/fonts/poppins-400.ttf');
    expect(font.status).toBe(200);
    expect(font.type).toMatch(/font\/ttf/);
    expect(font.body.length).toBeGreaterThan(1000);
  });
});
