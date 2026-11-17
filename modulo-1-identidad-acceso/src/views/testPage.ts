export const testPageHtml = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Consola de Pruebas OAuth2 / OIDC - Módulo 1</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0f172a;
            --card: #1e293b;
            --card-border: #334155;
            --text: #f8fafc;
            --text-dim: #94a3b8;
            --primary: #38bdf8;
            --primary-hover: #0284c7;
            --success: #10b981;
            --error: #ef4444;
            --code-bg: #090d16;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Inter', sans-serif;
            background: var(--bg);
            color: var(--text);
            padding: 2rem 1rem;
            display: flex;
            justify-content: center;
        }
        .container {
            width: 100%;
            max-width: 860px;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
        }
        .header {
            text-align: center;
            border-bottom: 1px solid var(--card-border);
            padding-bottom: 1.5rem;
        }
        .header h1 { font-size: 1.75rem; color: var(--primary); margin-bottom: 0.5rem; }
        .header p { color: var(--text-dim); font-size: 0.95rem; }
        .badge {
            display: inline-block;
            background: rgba(56, 189, 248, 0.15);
            color: var(--primary);
            border: 1px solid var(--primary);
            border-radius: 9999px;
            padding: 0.25rem 0.75rem;
            font-size: 0.8rem;
            margin-top: 0.5rem;
        }
        .card {
            background: var(--card);
            border: 1px solid var(--card-border);
            border-radius: 12px;
            padding: 1.5rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3);
        }
        .card h2 {
            font-size: 1.15rem;
            margin-bottom: 1rem;
            color: var(--text);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        .grid-2 {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-bottom: 1rem;
        }
        label {
            display: block;
            font-size: 0.85rem;
            color: var(--text-dim);
            margin-bottom: 0.4rem;
            font-weight: 500;
        }
        select, input {
            width: 100%;
            background: var(--code-bg);
            border: 1px solid var(--card-border);
            color: var(--text);
            padding: 0.6rem 0.8rem;
            border-radius: 6px;
            font-size: 0.9rem;
        }
        select:focus, input:focus {
            outline: 2px solid var(--primary);
            border-color: transparent;
        }
        .btn-group {
            display: flex;
            flex-wrap: wrap;
            gap: 0.75rem;
        }
        button {
            background: var(--primary);
            color: #0f172a;
            border: none;
            padding: 0.65rem 1.25rem;
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        button:hover { background: var(--primary-hover); color: #fff; }
        button.secondary {
            background: transparent;
            color: var(--primary);
            border: 1px solid var(--primary);
        }
        button.secondary:hover { background: rgba(56, 189, 248, 0.1); }
        .output-box {
            background: var(--code-bg);
            border: 1px solid var(--card-border);
            border-radius: 8px;
            padding: 1rem;
            margin-top: 1rem;
            font-family: monospace;
            font-size: 0.85rem;
            color: #38bdf8;
            overflow-x: auto;
            max-height: 280px;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .status-pill {
            padding: 0.2rem 0.6rem;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: 600;
        }
        .status-ok { background: rgba(16, 185, 129, 0.2); color: var(--success); }
        .status-err { background: rgba(239, 68, 68, 0.2); color: var(--error); }
        .links {
            display: flex;
            justify-content: center;
            gap: 1.5rem;
            font-size: 0.85rem;
        }
        .links a { color: var(--primary); text-decoration: none; }
        .links a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>Módulo 1: Identidad y Acceso</h1>
            <p>RF-1.5: Integración Estándar (OAuth2 / OpenID Connect) — Sprint 2 / AE2</p>
            <span class="badge">Backing Service: IdP Adapter (Google / Auth0 / Mock Sandbox)</span>
        </div>

        <div class="card">
            <h2>⚙️ 1. Configuración de Prueba</h2>
            <div class="grid-2">
                <div>
                    <label for="providerSelect">Proveedor de Identidad (IdP)</label>
                    <select id="providerSelect">
                        <option value="MOCK" selected>MOCK (Sandbox local sin internet)</option>
                        <option value="GOOGLE">GOOGLE (Requiere claves en .env)</option>
                        <option value="AUTH0">AUTH0 (Requiere claves en .env)</option>
                    </select>
                </div>
                <div>
                    <label for="roleSelect">Rol a Solicitar</label>
                    <select id="roleSelect">
                        <option value="CLIENTE" selected>CLIENTE</option>
                        <option value="CONDUCTOR">CONDUCTOR</option>
                        <option value="OPERADOR">OPERADOR</option>
                    </select>
                </div>
            </div>
            <div class="btn-group">
                <button onclick="runFullFlow()" id="btnFull">⚡ Probar Flujo Completo (1 Clic)</button>
                <button onclick="stepAuthorize()" class="secondary">Paso 1: /authorize</button>
                <button onclick="stepCallback()" class="secondary">Paso 2: /callback</button>
                <button onclick="stepValidate()" class="secondary">Paso 3: /validar-identidad-y-rol</button>
            </div>
        </div>

        <div class="card">
            <h2>
                📋 Resultado de la Operación
                <span id="statusIndicator" class="status-pill status-ok" style="display:none;">EXITOSO</span>
            </h2>
            <div id="output" class="output-box">// Aquí verás la respuesta de la API... Haz clic en "Probar Flujo Completo"</div>
        </div>

        <div class="links">
            <a href="/api-docs" target="_blank">📖 Swagger UI (/api-docs)</a>
            <a href="/health" target="_blank">🩺 Healthcheck (/health)</a>
            <a href="/auth/oauth2/providers" target="_blank">🌐 Proveedores (/auth/oauth2/providers)</a>
        </div>
    </div>

    <script>
        let currentState = "";
        let currentToken = "";

        const log = (msg) => {
            const out = document.getElementById("output");
            out.textContent = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
        };

        const setStatus = (ok, text) => {
            const pill = document.getElementById("statusIndicator");
            pill.style.display = "inline-block";
            pill.className = "status-pill " + (ok ? "status-ok" : "status-err");
            pill.textContent = text || (ok ? "EXITOSO" : "ERROR");
        };

        async function stepAuthorize() {
            const provider = document.getElementById("providerSelect").value;
            const role = document.getElementById("roleSelect").value;
            try {
                const res = await fetch('/auth/oauth2/authorize?provider=' + provider + '&role=' + role);
                const data = await res.json();
                if (!res.ok) throw data;
                currentState = data.state;
                setStatus(true, "AUTHORIZE OK");
                log({
                    paso: "1. Authorize iniciado",
                    provider: data.provider,
                    state: data.state,
                    authorizationUrl: data.authorizationUrl
                });
                return data;
            } catch (err) {
                setStatus(false, "ERROR");
                log(err);
                throw err;
            }
        }

        async function stepCallback() {
            if (!currentState) {
                alert("Primero debes ejecutar el Paso 1 (/authorize) para obtener un 'state' válido anti-CSRF.");
                return;
            }
            const provider = document.getElementById("providerSelect").value;
            try {
                const res = await fetch('/auth/oauth2/callback?provider=' + provider + '&code=mock_code_123&state=' + encodeURIComponent(currentState));
                const data = await res.json();
                if (!res.ok) throw data;
                currentToken = data.token;
                setStatus(true, "CALLBACK OK (JWT EMITIDO)");
                log({
                    paso: "2. Callback procesado y JWT emitido",
                    usuario: data.usuario,
                    tokenType: data.tokenType,
                    expiresIn: data.expiresIn,
                    token: data.token
                });
                return data;
            } catch (err) {
                setStatus(false, "ERROR");
                log(err);
                throw err;
            }
        }

        async function stepValidate() {
            if (!currentToken) {
                alert("Primero debes completar el Paso 2 para obtener un token JWT.");
                return;
            }
            try {
                const res = await fetch('/auth/validar-identidad-y-rol', {
                    headers: { 'Authorization': 'Bearer ' + currentToken }
                });
                const data = await res.json();
                if (!res.ok) throw data;
                setStatus(true, "TOKEN VALIDADO POR M1");
                log({
                    paso: "3. Identidad y rol validados (Integración con M2, M3, M5, M6)",
                    valid: data.valid,
                    usuario: data.usuario,
                    authMethod: data.authMethod,
                    linkedProviders: data.linkedProviders
                });
                return data;
            } catch (err) {
                setStatus(false, "ERROR");
                log(err);
                throw err;
            }
        }

        async function runFullFlow() {
            try {
                log("Ejecutando Paso 1: Iniciar autorización...");
                await stepAuthorize();
                await new Promise(r => setTimeout(r, 400));

                log("Ejecutando Paso 2: Procesar callback y canjear código por JWT...");
                await stepCallback();
                await new Promise(r => setTimeout(r, 400));

                log("Ejecutando Paso 3: Validar ticket emitido en /auth/validar-identidad-y-rol...");
                await stepValidate();
            } catch (e) {
                console.error(e);
            }
        }
    </script>
</body>
</html>
`;
