-- CreateTable
CREATE TABLE "Direccion" (
    "id" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "etiqueta" VARCHAR(60),
    "direccion" VARCHAR(250) NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "favorita" BOOLEAN NOT NULL DEFAULT false,
    "usos" INTEGER NOT NULL DEFAULT 0,
    "ultimoUso" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Direccion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionCliente" (
    "clienteId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RevisionCliente_pkey" PRIMARY KEY ("clienteId")
);

-- CreateTable
CREATE TABLE "Idempotencia" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "respuesta" JSONB NOT NULL,
    "estado" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Idempotencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inbox" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViajeProcesado" (
    "viajeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViajeProcesado_pkey" PRIMARY KEY ("viajeId")
);

-- CreateTable
CREATE TABLE "Outbox" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publicadoAt" TIMESTAMP(3),

    CONSTRAINT "Outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Direccion_clienteId_ultimoUso_idx" ON "Direccion"("clienteId", "ultimoUso");

-- CreateIndex
CREATE UNIQUE INDEX "Direccion_clienteId_tipo_clave_key" ON "Direccion"("clienteId", "tipo", "clave");

-- CreateIndex
CREATE INDEX "Outbox_publicadoAt_createdAt_idx" ON "Outbox"("publicadoAt", "createdAt");


-- Invariantes de dominio también al nivel relacional.
ALTER TABLE "Direccion" ADD CONSTRAINT "Direccion_tipo_check" CHECK ("tipo" IN ('ORIGEN', 'DESTINO'));
ALTER TABLE "Direccion" ADD CONSTRAINT "Direccion_coordenadas_check" CHECK ("latitud" BETWEEN -90 AND 90 AND "longitud" BETWEEN -180 AND 180);
ALTER TABLE "Direccion" ADD CONSTRAINT "Direccion_contadores_check" CHECK ("usos" >= 0 AND "version" > 0);
