const BASE_URL = 'http://localhost:3001';

/**
 * Test 1: Registrar Conductor (POST /auth/registrar-usuario)
 * Verifica que retorne los datos requeridos para el conductor (id, nombre, email, telefono, rol).
 */
async function testRegistrarConductor() {
  console.log('--------------------------------------------------');
  console.log('🔍 Test 1: POST /auth/registrar-usuario (CONDUCTOR)');
  try {
    const res = await fetch(`${BASE_URL}/auth/registrar-usuario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        nombre: 'Carlos',
        apellido: 'Rodriguez',
        dni: '23456789',
        telefono: '+541198765432',
        email: 'carlos.conductor@example.com',
        password: '123456password',
        rol: 'CONDUCTOR'
      })
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log('Respuesta:', JSON.stringify(data, null, 2));

    const tieneCamposRequeridos = data.id !== undefined &&
                                  Boolean(data.nombre) &&
                                  Boolean(data.email) &&
                                  Boolean(data.telefono) &&
                                  data.rol === 'CONDUCTOR';

    if ((res.status === 201 || res.status === 200) && tieneCamposRequeridos) {
      console.log('✅ Registro de Conductor exitoso. Campos verificados:');
      console.log(`   ➜ ID: ${data.id}`);
      console.log(`   ➜ Nombre: ${data.nombre}`);
      console.log(`   ➜ Email: ${data.email}`);
      console.log(`   ➜ Teléfono: ${data.telefono}`);
      console.log(`   ➜ Rol: ${data.rol}`);
      return true;
    } else {
      console.error('❌ Faltan datos requeridos del conductor o el rol no es CONDUCTOR.');
      return false;
    }
  } catch (err) {
    console.error('❌ Error en petición:', err.message);
    return false;
  }
}

/**
 * Test 2: Iniciar Sesión Conductor (POST /auth/iniciar-sesion)
 * Verifica los datos del objeto usuario dentro de LoginResponse.
 */
async function testIniciarSesionConductor() {
  console.log('--------------------------------------------------');
  console.log('🔍 Test 2: POST /auth/iniciar-sesion (CONDUCTOR)');
  try {
    const res = await fetch(`${BASE_URL}/auth/iniciar-sesion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        email: 'carlos.conductor@example.com',
        password: '123456password'
      })
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log('Respuesta:', JSON.stringify(data, null, 2));

    const usuario = data.usuario || {};
    const tieneCamposConductor = usuario.id !== undefined &&
                                 Boolean(usuario.nombre) &&
                                 Boolean(usuario.email) &&
                                 Boolean(usuario.telefono) &&
                                 usuario.rol === 'CONDUCTOR';

    if (res.status === 200 && data.token && tieneCamposConductor) {
      console.log('✅ Inicio de sesión de Conductor exitoso. Datos de Conductor verificados:');
      console.log(`   ➜ Token: ${data.token}`);
      console.log(`   ➜ Conductor ID: ${usuario.id}`);
      console.log(`   ➜ Nombre: ${usuario.nombre}`);
      console.log(`   ➜ Email: ${usuario.email}`);
      console.log(`   ➜ Teléfono: ${usuario.telefono}`);
      console.log(`   ➜ Rol: ${usuario.rol}`);
      return true;
    } else {
      console.error('❌ La respuesta de inicio de sesión no contiene la información esperada del Conductor.');
      return false;
    }
  } catch (err) {
    console.error('❌ Error en petición:', err.message);
    return false;
  }
}

/**
 * Test 3: Validar Identidad y Rol (GET /auth/validar-identidad-y-rol)
 * Verifica que el token retorne rol CONDUCTOR.
 */
async function testValidarIdentidadConductor() {
  console.log('--------------------------------------------------');
  console.log('🔍 Test 3: GET /auth/validar-identidad-y-rol (CONDUCTOR)');
  try {
    const res = await fetch(`${BASE_URL}/auth/validar-identidad-y-rol`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer token_conductor_valido',
        'Accept': 'application/json'
      }
    });

    console.log(`Status: ${res.status} ${res.statusText}`);
    const data = await res.json();
    console.log('Respuesta:', JSON.stringify(data, null, 2));

    if (res.status === 200 && data.valid === true && data.role === 'CONDUCTOR') {
      console.log('✅ Validacion de identidad exitosa: El usuario es un CONDUCTOR valido.');
      console.log(`   ➜ User ID: ${data.userId}`);
      console.log(`   ➜ Role: ${data.role}`);
      return true;
    } else {
      console.error('❌ La validación no retornó el rol CONDUCTOR esperado.');
      return false;
    }
  } catch (err) {
    console.error('❌ Error en petición:', err.message);
    return false;
  }
}

async function main() {
  console.log('🚀 Iniciando pruebas de datos de CONDUCTOR contra M1 (Stoplight Prism)...');
  const t1 = await testRegistrarConductor();
  const t2 = await testIniciarSesionConductor();
  const t3 = await testValidarIdentidadConductor();
  console.log('--------------------------------------------------');
  if (t1 && t2 && t3) {
    console.log('🎉 Pruebas exitosas: Los datos requeridos de CONDUCTOR (ID, Nombre, Email, Teléfono, Rol) son proporcionados correctamente por M1.');
  } else {
    console.log('⚠️ Alguna de las verificaciones de datos de CONDUCTOR falló.');
  }
}

main();
