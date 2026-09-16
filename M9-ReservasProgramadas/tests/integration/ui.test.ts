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
    expect(page.text).toContain('Próximas reservas');
    expect(styles.status).toBe(200);
    expect(styles.type).toMatch(/css/);
    expect(script.status).toBe(200);
    expect(script.type).toMatch(/javascript/);
  });
});
