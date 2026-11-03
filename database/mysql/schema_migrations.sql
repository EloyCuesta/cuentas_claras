-- Historial de las migraciones de MySQL, propio y separado del de SQLite.
-- Lo crea el servidor Node (server/common/mysql/migrations.ts) antes de aplicar
-- nada, y lo podrá crear igual el backend .NET: misma tabla, mismos datos.
--
-- Una fila por migración: se anota al empezar (started_at) y se completa al
-- terminar (applied_at). applied_at NULL significa que una migración empezó y
-- no terminó. Como el DDL de MySQL se confirma solo, la base puede tener parte
-- de sus cambios: la aplicación lo explica y no continúa.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INT          NOT NULL,
  name       VARCHAR(200) NOT NULL,
  started_at VARCHAR(40)  NOT NULL,
  applied_at VARCHAR(40)  NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;
