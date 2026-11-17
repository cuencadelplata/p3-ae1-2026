-- El listado paginado usa este orden incluso sin filtrar por estado.
CREATE INDEX "reservations_scheduled_at_id_idx" ON "reservations"("scheduled_at", "id");
