-- CreateTable
CREATE TABLE "calificaciones" (
    "id" TEXT NOT NULL,
    "viaje_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "conductor_id" TEXT NOT NULL,
    "puntuacion" INTEGER NOT NULL,
    "comentario" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calificaciones_viaje_id_key" ON "calificaciones"("viaje_id");

-- CreateIndex
CREATE INDEX "calificaciones_cliente_id_idx" ON "calificaciones"("cliente_id");

-- CreateIndex
CREATE INDEX "calificaciones_conductor_id_idx" ON "calificaciones"("conductor_id");

