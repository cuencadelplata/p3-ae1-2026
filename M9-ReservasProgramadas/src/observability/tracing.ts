import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Link,
  type Span,
} from '@opentelemetry/api';

export const TRACER_NAME = 'm9-reservas';

export const tracer = () => trace.getTracer(TRACER_NAME);

export interface SpanOptions {
  kind?: SpanKind;
  attributes?: Attributes;
  links?: Link[];
  /** Contexto padre explícito (p. ej. extraído de un mensaje o de un evento Outbox). */
  parent?: Context;
  /** Inicia una traza nueva aunque haya un span activo (trabajo diferido). */
  root?: boolean;
}

/** Solo el tipo de error: los mensajes pueden contener datos de clientes. */
export const markSpanError = (span: Span, error: unknown): void => {
  const errorType = error instanceof Error ? error.name : 'UNKNOWN_ERROR';
  span.setAttribute('error.type', errorType);
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
};

export const withSpan = async <T>(
  name: string,
  action: (span: Span) => Promise<T>,
  options: SpanOptions = {},
): Promise<T> => {
  const parent = options.root === true ? ROOT_CONTEXT : (options.parent ?? context.active());
  const span = tracer().startSpan(
    name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      ...(options.attributes === undefined ? {} : { attributes: options.attributes }),
      ...(options.links === undefined ? {} : { links: options.links }),
      ...(options.root === true ? { root: true } : {}),
    },
    parent,
  );
  try {
    return await context.with(trace.setSpan(parent, span), () => action(span));
  } catch (error) {
    markSpanError(span, error);
    throw error;
  } finally {
    span.end();
  }
};

export type TraceCarrier = Record<string, string>;

/** Serializa el contexto activo en formato W3C (`traceparent`, `tracestate`, `baggage`). */
export const injectTraceContext = (ctx: Context = context.active()): TraceCarrier => {
  const carrier: TraceCarrier = {};
  propagation.inject(ctx, carrier);
  return carrier;
};

const isCarrier = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Recupera un contexto W3C desde headers AMQP/HTTP o desde JSON persistido. */
export const extractTraceContext = (carrier: unknown, base: Context = ROOT_CONTEXT): Context => {
  if (!isCarrier(carrier)) return base;
  const normalized: TraceCarrier = {};
  for (const key of ['traceparent', 'tracestate', 'baggage']) {
    const value = carrier[key];
    if (typeof value === 'string' && value.length <= 512) normalized[key] = value;
    else if (Buffer.isBuffer(value) && value.length <= 512) normalized[key] = value.toString();
  }
  return Object.keys(normalized).length === 0 ? base : propagation.extract(base, normalized);
};

/** Contexto persistible: `null` si no hay un span válido activo (telemetría apagada). */
export const persistableTraceContext = (): TraceCarrier | null => {
  const carrier = injectTraceContext();
  return carrier.traceparent === undefined ? null : carrier;
};

export const currentTraceIds = (): { traceId: string; spanId: string } | undefined => {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext === undefined || !trace.isSpanContextValid(spanContext)) return undefined;
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
};

export { SpanKind };
