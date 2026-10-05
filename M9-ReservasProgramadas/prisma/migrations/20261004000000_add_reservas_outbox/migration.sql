-- CreateTable
CREATE TABLE "reservas" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "origen" VARCHAR(200) NOT NULL,
    "destino" VARCHAR(200) NOT NULL,
    "vehiculo" "tipo_vehiculo" NOT NULL,
    "fecha_hora_programada" TIMESTAMPTZ(3) NOT NULL,
    "estado" "estado_reserva" NOT NULL DEFAULT 'PENDIENTE_ASIGNACION',
    "asignacion_id" TEXT,
    "chofer_id" TEXT,
    "nombre_chofer" VARCHAR(200),
    "valoracion" DECIMAL(3,2),
    "tarifa_estimada" DECIMAL(12,2),
    "moneda" VARCHAR(3) DEFAULT 'ARS',
    "criterio_asignacion" VARCHAR(80),
    "id_solicitud" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reserva_versiones" (
    "reserva_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "cliente_id" UUID NOT NULL,
    "origen" VARCHAR(200) NOT NULL,
    "destino" VARCHAR(200) NOT NULL,
    "vehiculo" "tipo_vehiculo" NOT NULL,
    "fecha_hora_programada" TIMESTAMPTZ(3) NOT NULL,
    "estado" "estado_reserva" NOT NULL DEFAULT 'PENDIENTE_ASIGNACION',
    "asignacion_id" TEXT,
    "chofer_id" TEXT,
    "nombre_chofer" VARCHAR(200),
    "valoracion" DECIMAL(3,2),
    "tarifa_estimada" DECIMAL(12,2),
    "moneda" VARCHAR(3) DEFAULT 'ARS',
    "criterio_asignacion" VARCHAR(80),
    "id_solicitud" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserva_versiones_pkey" PRIMARY KEY ("reserva_id", "version")
);

-- CreateTable
CREATE TABLE "outbox_eventos" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(100) NOT NULL,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "procesado_en" TIMESTAMPTZ(3),
    "reserva_id" UUID,

    CONSTRAINT "outbox_eventos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservas_estado_fecha_hora_programada_id_idx"
    ON "reservas"("estado", "fecha_hora_programada", "id");

CREATE INDEX "reservas_cliente_id_fecha_hora_programada_id_idx"
    ON "reservas"("cliente_id", "fecha_hora_programada", "id");

CREATE INDEX "reserva_versiones_estado_fecha_hora_programada_reserva_id_v_idx"
    ON "reserva_versiones"("estado", "fecha_hora_programada", "reserva_id", "version");

CREATE INDEX "reserva_versiones_cliente_id_fecha_hora_programada_reserva__idx"
    ON "reserva_versiones"("cliente_id", "fecha_hora_programada", "reserva_id", "version");

CREATE INDEX "outbox_eventos_status_creado_en_idx"
    ON "outbox_eventos"("status", "creado_en");

CREATE INDEX "outbox_eventos_aggregate_type_aggregate_id_creado_en_idx"
    ON "outbox_eventos"("aggregate_type", "aggregate_id", "creado_en");

-- AddForeignKey
ALTER TABLE "reserva_versiones"
    ADD CONSTRAINT "reserva_versiones_reserva_id_fkey"
    FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "outbox_eventos"
    ADD CONSTRAINT "outbox_eventos_reserva_id_fkey"
    FOREIGN KEY ("reserva_id") REFERENCES "reservas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
