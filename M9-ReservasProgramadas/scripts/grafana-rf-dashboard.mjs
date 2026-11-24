/** Pestañas nativas del modelo V2 de Grafana. No genera dashboards separados. */
export const buildFunctionalDashboard = ({
  sections,
  variables,
  stat,
  ts,
  logs,
  traces,
  q,
  S,
  BIZ,
}) => {
  const original = sections.flatMap((section) =>
    section.panels.filter((panel) => panel.type !== 'row'),
  );
  const taken = new Set();
  const take = (title) => {
    const panel = original.find((item) => item.title === title);
    if (!panel) throw new Error(`No existe el panel de diagnóstico: ${title}`);
    taken.add(panel);
    return panel;
  };
  const note = (content) => ({
    type: 'text',
    title: 'Alcance y lectura del RF',
    gridPos: { w: 24, h: 5 },
    options: { mode: 'markdown', content },
  });
  const http = (method, route = '/reservas(/:id)?') =>
    `${BIZ},http_request_method="${method}",http_route=~"${route}"`;
  const logScope = '{service_name="$service"} | deployment_environment_name=~"$env"';
  const httpLogs = (method, description = '') =>
    logs(
      'Logs de solicitudes del RF',
      `${logScope} | method=~"${method}" | path=~"/reservas(/:id)?"`,
      { description },
    );
  const rfTraces = (names, description = '') =>
    traces(
      'Trazas del RF',
      `{ resource.service.name = "$service" && resource.deployment.environment.name =~ "$env" && (${names.map((name) => `name = "${name}"`).join(' || ')}) }`,
      { description },
    );
  const operations = (operation) => [
    stat(
      'Operaciones confirmadas (rango)',
      `sum(increase(m9_reservation_operations_total{${S},operation="${operation}",result="success"}[$__range]))`,
      { w: 6 },
    ),
    ts(
      'Resultados y motivos de rechazo',
      [
        [
          `sum by (result, reason) (increase(m9_reservation_operations_total{${S},operation="${operation}"}[$__rate_interval]))`,
          '{{result}} · {{reason}}',
        ],
      ],
      { w: 18 },
    ),
  ];
  const httpLatency = (method) =>
    ts(
      'Latencia HTTP p50 / p95 / p99',
      [
        [q(0.5, `http_server_request_duration_seconds_bucket{${http(method)}}`), 'p50'],
        [q(0.95, `http_server_request_duration_seconds_bucket{${http(method)}}`), 'p95'],
        [q(0.99, `http_server_request_duration_seconds_bucket{${http(method)}}`), 'p99'],
      ],
      { unit: 's', w: 24 },
    );
  const httpResults = (method) =>
    ts(
      'Respuestas HTTP (incluye validaciones previas al servicio)',
      [
        [
          `sum by (http_response_status_code) (increase(http_server_request_duration_seconds_count{${http(method)}}[$__rate_interval]))`,
          '{{http_response_status_code}}',
        ],
      ],
      { w: 24 },
    );
  const dependencyMetrics = (dependency) => [
    ts(
      `Llamadas a ${dependency.toUpperCase()} por resultado`,
      [
        [
          `sum by (operation, outcome, target) (rate(m9_dependency_requests_total{${S},dependency="${dependency}"}[$__rate_interval]))`,
          '{{operation}} · {{outcome}} · {{target}}',
        ],
      ],
      { unit: 'ops' },
    ),
    ts(
      `Latencia p95 de ${dependency.toUpperCase()}`,
      [
        [
          q(
            0.95,
            `m9_dependency_request_duration_seconds_bucket{${S},dependency="${dependency}"}`,
            'operation',
          ),
          '{{operation}}',
        ],
      ],
      { unit: 's' },
    ),
  ];

  const tabs = [
    {
      title: 'RF-9.1 · Crear reserva',
      panels: [
        note(
          '### RF-9.1 — Crear reserva\nFecha futura y estado inicial **PROGRAMADA**. Las operaciones confirmadas se cuentan después del commit. Los rechazos aparecen por resultado/motivo; un HTTP 201 no garantiza que M7 haya devuelto tarifa (ver RF-9.6).',
        ),
        ...operations('create'),
        stat(
          'Transiciones iniciales a PROGRAMADA',
          `sum(increase(m9_reservation_transitions_total{${S},from="NONE",to="PROGRAMADA"}[$__range]))`,
          { w: 24 },
        ),
        httpLatency('POST'),
        httpResults('POST'),
        httpLogs('POST'),
        rfTraces(['POST /reservas', 'ReservaService.create']),
      ],
    },
    {
      title: 'RF-9.2 · Consultar reserva',
      panels: [
        note(
          '### RF-9.2 — Consultar reserva\nConsultas individuales y listados mediante la API de M9; tiempos, estados HTTP y caché. **Un GET exitoso no certifica propiedad de los datos.** La autorización por cliente requiere revisión/pruebas específicas; este dashboard no expone direcciones, tarifas individuales ni identificadores de clientes como etiquetas de métricas.',
        ),
        stat(
          'Consultas HTTP (rango)',
          `sum(increase(http_server_request_duration_seconds_count{${http('GET')}}[$__range]))`,
          { w: 24 },
        ),
        httpLatency('GET'),
        ts(
          'Consultas por ruta y respuesta HTTP',
          [
            [
              `sum by (http_route, http_response_status_code) (rate(http_server_request_duration_seconds_count{${http('GET')}}[$__rate_interval]))`,
              '{{http_route}} · {{http_response_status_code}}',
            ],
          ],
          { unit: 'reqps' },
        ),
        take('Hit ratio de lecturas'),
        httpLogs('GET'),
        rfTraces([
          'GET /reservas',
          'GET /reservas/:id',
          'ReservaService.get',
          'ReservaService.list',
          'ReservaService.list_page',
        ]),
      ],
    },
    {
      title: 'RF-9.3 · Modificar reserva',
      panels: [
        note(
          '### RF-9.3 — Modificar reserva\nModificaciones y rechazos de la API en estado PROGRAMADA. La implementación actual permite fecha/hora, origen, destino y vehículo. **La edición del conductor mencionada en el RF no está implementada en el DTO actual.** No hay un indicador de cumplimiento que oculte esa diferencia.',
        ),
        ...operations('update'),
        httpLatency('PATCH'),
        httpResults('PATCH'),
        httpLogs('PATCH'),
        rfTraces(['PATCH /reservas/:id', 'ReservaService.update']),
      ],
    },
    {
      title: 'RF-9.4 · Cancelar reserva',
      panels: [
        note(
          '### RF-9.4 — Cancelar reserva\nCancelaciones lógicas y transiciones a CANCELADA, sin eliminación física. **Diferencia con el requisito recibido:** el código también permite cancelar ciertos casos ACTIVANDO, coordinándose con M5. El gráfico por estado de origen permite observarlos; este dashboard no modifica esa política.',
        ),
        ...operations('cancel'),
        ts(
          'Cancelaciones por estado anterior',
          [
            [
              `sum by (from) (increase(m9_reservation_transitions_total{${S},to="CANCELADA"}[$__rate_interval]))`,
              '{{from}} → CANCELADA',
            ],
          ],
          { w: 24 },
        ),
        httpLatency('DELETE'),
        httpResults('DELETE'),
        httpLogs('DELETE'),
        rfTraces(['DELETE /reservas/:id', 'ReservaService.cancel']),
      ],
    },
    {
      title: 'RF-9.5 · Activar reserva',
      panels: [
        note(
          '### RF-9.5 — Activar reserva\nScheduler, reservas vencidas, retraso y resultado final. **ACTIVANDO no equivale a ACTIVADA**: la asignación debe confirmarse desde M5. Los logs actuales del scheduler cubren errores y resultados de eventos; los ciclos exitosos se observan en métricas/trazas, aunque no produzcan un log.',
        ),
        ...[
          'Reservas por estado',
          'PROGRAMADA vencidas sin activar',
          'ACTIVANDO estancadas',
          'Activaciones finales',
          'Éxito de activación (rango)',
          'Retraso de inicio de activación p50/p95',
          'Resolución final p95 por resultado',
          'Antigüedad de vencidas y ACTIVANDO',
          'Ejecuciones por resultado',
          'Duración de ejecución p95 y candidatas',
          'Segundos desde la última ejecución exitosa',
        ].map(take),
        logs(
          'Logs de activación y scheduler',
          `${logScope} |~ "reservation_scheduler_error|dispatch_result_processed"`,
        ),
        rfTraces(['scheduler.run', 'reservation.activate']),
      ],
    },
    {
      title: 'RF-9.6 · Tarifa estimada',
      panels: [
        note(
          '### RF-9.6 — Consultar tarifa estimada\nM7 calcula el importe; M9 consulta y guarda/presenta la estimación. Las llamadas, latencias y degradaciones son señales directas. Los logs HTTP de creación/modificación son **contexto**, no confirmación de una llamada a M7: cambiar solo la fecha no recalcula tarifa. No se registra el importe individual como métrica.',
        ),
        ...dependencyMetrics('m7'),
        take('Degradaciones de tarifa/ruta (respuesta 2xx sin tarifa)'),
        httpLogs(
          'POST|PATCH',
          'Solicitudes relacionadas; no todas las modificaciones necesitan recalcular la tarifa.',
        ),
        rfTraces(
          ['ReservaService.create', 'ReservaService.update'],
          'Abrir la traza y revisar los spans HTTP cliente hacia M7. Las modificaciones de fecha no necesitan esa llamada.',
        ),
      ],
    },
    {
      title: 'RF-9.7 · Mejor calificación',
      panels: [
        note(
          '### RF-9.7 — Priorizar conductores por mejor calificación\n**Pendiente de evidencia específica.** El cuerpo REST que M9 envía actualmente a M5 contiene origen, destino y vehículo; no incluye el criterio de asignación. M9 tampoco emite métricas de puntuaciones, orden de candidatos, ofertas, rechazos o vencimientos. Los paneles siguientes son contexto de comunicación/asignación y **no prueban esta regla**. Registrar MEJOR_VALORACION en el resultado local no demuestra que M5 haya priorizado por calificación. La verificación exige contrato y señales de M5.',
        ),
        ...dependencyMetrics('m5'),
        stat(
          'Asignaciones confirmadas por M5 (contexto)',
          `sum(increase(m9_reservation_transitions_total{${S},from="ACTIVANDO",to="ACTIVADA"}[$__range]))`,
          {
            w: 24,
            description:
              'Una asignación confirmada no certifica el orden por calificación ni la secuencia de ofertas.',
          },
        ),
        logs(
          'Logs disponibles de integración con M5',
          `${logScope} |~ "reservation_scheduler_error|dispatch_result_processed"`,
          {
            description:
              'Errores de despacho o resultados del flujo por eventos; M9 no registra el ciclo de ofertas de M5.',
          },
        ),
        rfTraces(
          ['reservation.activate'],
          'Contexto del despacho. Los spans de M9 no prueban las decisiones internas de M5.',
        ),
      ],
    },
    {
      title: 'Diagnóstico e infraestructura',
      panels: [
        note(
          '### Diagnóstico común\nAPI global, runtime del proceso Node.js, PostgreSQL, Redis, locks, Outbox, RabbitMQ, Inbox, logs y trazas. Se conservan los paneles originales que no se trasladaron a un RF. El filtro RUN_ID se utiliza en los paneles k6; el trabajo diferido del scheduler puede tener otra correlación.',
        ),
        ...original.filter((panel) => !taken.has(panel)),
      ],
    },
  ];

  const elements = {};
  let id = 0;
  const layoutTabs = tabs.map((tab) => {
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    const items = tab.panels.map((panel) => {
      const width = panel.gridPos?.w ?? 24;
      const height = panel.gridPos?.h ?? 8;
      if (x + width > 24) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }
      const name = `panel-${++id}`;
      elements[name] = panelV2(panel, id);
      const item = {
        kind: 'GridLayoutItem',
        spec: { x, y, width, height, element: { kind: 'ElementReference', name } },
      };
      x += width;
      rowHeight = Math.max(rowHeight, height);
      return item;
    });
    return {
      kind: 'TabsLayoutTab',
      spec: { title: tab.title, layout: { kind: 'GridLayout', spec: { items } } },
    };
  });
  return {
    apiVersion: 'dashboard.grafana.app/v2',
    kind: 'Dashboard',
    metadata: { name: 'm9-ae4-general' },
    spec: {
      title: 'M9 Reservas · Requerimientos funcionales',
      description:
        'Un dashboard con pestañas RF-9.1 a RF-9.7 y diagnóstico compartido. Las señales observables se distinguen de los requisitos todavía no instrumentados o no implementados.',
      tags: ['m9', 'reservas', 'ae4', 'opentelemetry', 'requerimientos-funcionales'],
      editable: true,
      cursorSync: 'Off',
      preload: false,
      annotations: [],
      links: [],
      elements,
      layout: { kind: 'TabsLayout', spec: { tabs: layoutTabs } },
      variables: variables.map(variableV2),
      timeSettings: {
        from: 'now-1h',
        to: 'now',
        timezone: 'browser',
        autoRefresh: '30s',
        autoRefreshIntervals: ['10s', '30s', '1m', '5m', '15m'],
        hideTimepicker: false,
        fiscalYearStartMonth: 0,
      },
    },
  };
};

const dataQueryV2 = (datasource, spec) => ({
  kind: 'DataQuery',
  group: datasource.type,
  version: 'v0',
  datasource: { name: datasource.uid },
  spec,
});

const panelV2 = (panel, id) => ({
  kind: 'Panel',
  spec: {
    id,
    title: panel.title,
    description: panel.description ?? '',
    links: [],
    data: {
      kind: 'QueryGroup',
      spec: {
        queries: (panel.targets ?? []).map(({ refId, datasource, ...query }) => ({
          kind: 'PanelQuery',
          spec: { refId, hidden: false, query: dataQueryV2(datasource ?? panel.datasource, query) },
        })),
        transformations: [],
        queryOptions: {},
      },
    },
    vizConfig: {
      kind: 'VizConfig',
      group: panel.type,
      version: '',
      spec: {
        options: panel.options ?? {},
        fieldConfig: panel.fieldConfig ?? { defaults: {}, overrides: [] },
      },
    },
  },
});

const variableV2 = (variable) => {
  const common = {
    name: variable.name,
    label: variable.label,
    hide: 'dontHide',
    skipUrlSync: false,
    current: { text: '', value: '', ...variable.current },
  };
  if (variable.type === 'textbox')
    return { kind: 'TextVariable', spec: { ...common, query: variable.query } };
  const options = {
    ...common,
    refresh: 'onDashboardLoad',
    regex: '',
    options: [],
    multi: variable.multi ?? false,
    includeAll: variable.includeAll ?? false,
    allowCustomValue: false,
    ...(variable.allValue === undefined ? {} : { allValue: variable.allValue }),
  };
  if (variable.type === 'datasource')
    return { kind: 'DatasourceVariable', spec: { ...options, pluginId: variable.query } };
  return {
    kind: 'QueryVariable',
    spec: {
      ...options,
      sort: 'disabled',
      refresh: 'onTimeRangeChanged',
      ...(variable.includeAll ? { current: { text: 'Todos', value: '$__all' } } : {}),
      query: dataQueryV2(variable.datasource, { qryType: 1, ...variable.query }),
    },
  };
};
