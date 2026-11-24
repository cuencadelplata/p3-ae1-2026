-- AE4: contexto W3C (traceparent/tracestate) capturado al crear el evento Outbox.
-- Columna nullable: los eventos anteriores quedan con NULL y se publican en una traza nueva.
ALTER TABLE "outbox_events" ADD COLUMN "trace_context" JSONB;
