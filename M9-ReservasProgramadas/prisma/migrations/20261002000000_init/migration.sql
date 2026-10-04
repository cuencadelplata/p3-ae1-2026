-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "estado_reserva" AS ENUM ('PENDIENTE_ASIGNACION', 'PROGRAMADA', 'ACTIVANDO', 'ACTIVADA', 'CANCELADA', 'FALLIDA');

-- CreateEnum
CREATE TYPE "tipo_vehiculo" AS ENUM ('AUTO', 'MOTO');

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

-- CreateIndex
CREATE INDEX "reserva_versiones_estado_fecha_hora_programada_reserva_id_v_idx" ON "reserva_versiones"("estado", "fecha_hora_programada", "reserva_id", "version");

-- CreateIndex
CREATE INDEX "reserva_versiones_cliente_id_fecha_hora_programada_reserva__idx" ON "reserva_versiones"("cliente_id", "fecha_hora_programada", "reserva_id", "version");