-- Migración 5: esquema inicial de MySQL.
--
-- Equivale al esquema final de SQLite después de sus migraciones 001 a 005
-- (tools/sqlite/, que no se editan): las mismas doce tablas de la aplicación,
-- con sus columnas en el mismo orden, claves primarias, claves foráneas con
-- sus acciones, CHECK e índices. Empieza en la versión 5 para que el esquema
-- que informa /api/health siga siendo 5. Añade app_locks, que no existía en
-- SQLite porque allí todo se escribía en serie.
--
-- Cómo se escribe (lo leen el servidor Node y, más adelante, .NET):
-- - comentarios solo en líneas propias que empiezan por «--»;
-- - cada sentencia termina con «;» al final de una línea;
-- - el DDL de MySQL se confirma solo: si algo falla a medias, la fila de
--   schema_migrations queda sin applied_at y la aplicación no continúa.
--
-- Todas las tablas son InnoDB, utf8mb4 y utf8mb4_0900_bin. Esa colación
-- compara como SQLite: «pina», «piña» y «PINA» son claves distintas y «abc»
-- no es «abc ». La de MySQL por defecto (utf8mb4_0900_ai_ci) uniría
-- equivalencias de tickets distintas y utf8mb4_bin iguala espacios finales.
--
-- Tipos:
-- - céntimos en BIGINT; cantidades y objetivos en DECIMAL(10,3) (milésimas
--   exactas hasta 1.000.000); el peso en DECIMAL(7,3); el orden en DOUBLE;
-- - fechas de calendario en DATE (sin hora ni zona) y la hora del ticket en
--   VARCHAR(5) («HH:MM»; TIME devolvería «HH:MM:SS»);
-- - created_at y updated_at en VARCHAR(40): la copia financiera admite
--   cualquier texto de hasta 40 caracteres y se restaura idéntica (DATETIME
--   rechazaría «…T…Z»);
-- - booleanos en TINYINT 0/1; ajustes, avisos y evidencia en MEDIUMTEXT, con
--   el texto exacto (el tipo JSON devolvería objetos y normalizaría el texto).
--
-- Cada VARCHAR se dimensiona con los validadores de shared/: ids de hasta 100,
-- nombres de categoría de 200, conceptos de 500 y notas de 5000
-- (shared/finance/backup.ts); productos de 80, personas de 40 y notas de 120
-- (shared/pantry/pantry.ts); tienda de 60 y dirección de 120
-- (shared/tickets/ticketValidation.ts). name_key admite 240 porque pasar a
-- mayúsculas puede triplicar una ligadura («ﬃ» → «FFI») de un nombre de 80.

-- Finanzas -----------------------------------------------------------------

CREATE TABLE categories (
  id           VARCHAR(100) NOT NULL,
  name         VARCHAR(200) NOT NULL,
  type         VARCHAR(10)  NOT NULL,
  parent_id    VARCHAR(100) NULL,
  order_index  DOUBLE       NOT NULL DEFAULT 0,
  budget_cents BIGINT       NULL,
  PRIMARY KEY (id),
  KEY categories_parent (parent_id),
  CONSTRAINT categories_parent_fk FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE CASCADE,
  CONSTRAINT categories_type_chk CHECK (type IN ('ingreso', 'gasto')),
  CONSTRAINT categories_budget_chk CHECK (budget_cents IS NULL OR budget_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE recurring_rules (
  id           VARCHAR(100)  NOT NULL,
  concept      VARCHAR(500)  NOT NULL,
  amount_cents BIGINT        NOT NULL,
  type         VARCHAR(10)   NOT NULL,
  category_id  VARCHAR(100)  NOT NULL,
  frequency    VARCHAR(10)   NOT NULL,
  start_date   DATE          NOT NULL,
  end_date     DATE          NULL,
  installments INT           NULL,
  notes        VARCHAR(5000) NOT NULL DEFAULT '',
  created_at   VARCHAR(40)   NOT NULL,
  updated_at   VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  KEY recurring_rules_category (category_id),
  CONSTRAINT recurring_rules_category_fk FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT recurring_rules_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT recurring_rules_type_chk CHECK (type IN ('ingreso', 'gasto')),
  CONSTRAINT recurring_rules_frequency_chk CHECK (frequency IN ('mensual', 'trimestral', 'semestral', 'anual')),
  CONSTRAINT recurring_rules_installments_chk CHECK (installments IS NULL OR installments > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Vencimientos que se han eliminado y no deben volver a generarse.
CREATE TABLE recurring_excluded_dates (
  rule_id VARCHAR(100) NOT NULL,
  date    DATE         NOT NULL,
  PRIMARY KEY (rule_id, date),
  CONSTRAINT recurring_excluded_dates_rule_fk FOREIGN KEY (rule_id) REFERENCES recurring_rules (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- recurring_id no es clave foránea a propósito: al borrar un recurrente se
-- conservan sus vencimientos pagados. El índice único (recurring_id,
-- occurrence_date) impide un vencimiento repetido; los movimientos normales
-- tienen recurring_id NULL y varios NULL no chocan, como en SQLite.
CREATE TABLE movements (
  id                 VARCHAR(100)  NOT NULL,
  concept            VARCHAR(500)  NOT NULL,
  amount_cents       BIGINT        NOT NULL,
  type               VARCHAR(10)   NOT NULL,
  category_id        VARCHAR(100)  NOT NULL,
  status             VARCHAR(10)   NOT NULL,
  paid_date          DATE          NULL,
  due_date           DATE          NULL,
  notes              VARCHAR(5000) NOT NULL DEFAULT '',
  recurring_id       VARCHAR(100)  NULL,
  occurrence_date    DATE          NULL,
  installment_number INT           NULL,
  created_at         VARCHAR(40)   NOT NULL,
  updated_at         VARCHAR(40)   NOT NULL,
  PRIMARY KEY (id),
  KEY movements_category (category_id),
  KEY movements_recurring (recurring_id),
  UNIQUE KEY movements_occurrence (recurring_id, occurrence_date),
  CONSTRAINT movements_category_fk FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT movements_amount_chk CHECK (amount_cents > 0),
  CONSTRAINT movements_type_chk CHECK (type IN ('ingreso', 'gasto')),
  CONSTRAINT movements_status_chk CHECK (status IN ('pendiente', 'realizado')),
  CONSTRAINT movements_paid_chk CHECK (status <> 'realizado' OR paid_date IS NOT NULL),
  CONSTRAINT movements_due_chk CHECK (status <> 'pendiente' OR due_date IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Datos auxiliares (fecha de la última copia y de la importación del
-- navegador). «key» es palabra reservada en MySQL: siempre entre comillas
-- invertidas. El valor llega de PUT /api/meta (hasta 100) y de POST
-- /api/import, que no lo limita: MEDIUMTEXT como el TEXT de SQLite.
CREATE TABLE meta (
  `key` VARCHAR(40) NOT NULL,
  value MEDIUMTEXT  NOT NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Despensa ------------------------------------------------------------------

CREATE TABLE pantry_people (
  id         VARCHAR(100) NOT NULL,
  name       VARCHAR(40)  NOT NULL,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT pantry_people_name_chk CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 40)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- owner_id NULL = Compartido; una persona con productos no se borra
-- (RESTRICT). version sube en cada escritura para poder deshacer sin pisar
-- cambios. tracking va al final, como quedó en SQLite (migración 003).
CREATE TABLE pantry_items (
  id          VARCHAR(100)  NOT NULL,
  name        VARCHAR(80)   NOT NULL,
  owner_id    VARCHAR(100)  NULL,
  unit        VARCHAR(10)   NOT NULL,
  quantity    DECIMAL(10,3) NOT NULL,
  target      DECIMAL(10,3) NOT NULL,
  frequency   VARCHAR(10)   NOT NULL,
  price_cents BIGINT        NULL,
  notes       VARCHAR(120)  NOT NULL DEFAULT '',
  version     INT           NOT NULL DEFAULT 1,
  created_at  VARCHAR(40)   NOT NULL,
  updated_at  VARCHAR(40)   NOT NULL,
  tracking    VARCHAR(10)   NOT NULL DEFAULT 'cantidad',
  PRIMARY KEY (id),
  KEY pantry_items_owner (owner_id),
  CONSTRAINT pantry_items_owner_fk FOREIGN KEY (owner_id) REFERENCES pantry_people (id) ON DELETE RESTRICT,
  CONSTRAINT pantry_items_name_chk CHECK (CHAR_LENGTH(TRIM(name)) BETWEEN 1 AND 80),
  CONSTRAINT pantry_items_unit_chk CHECK (unit IN ('ud', 'g', 'kg', 'ml', 'l', 'paquete', 'lata', 'botella', 'bolsa', 'docena')),
  CONSTRAINT pantry_items_quantity_chk CHECK (quantity >= 0 AND quantity <= 1000000),
  CONSTRAINT pantry_items_target_chk CHECK (target >= 0 AND target <= 1000000),
  CONSTRAINT pantry_items_frequency_chk CHECK (frequency IN ('semanal', 'mensual', 'ocasional')),
  CONSTRAINT pantry_items_price_chk CHECK (price_cents IS NULL OR (price_cents >= 0 AND price_cents <= 10000000)),
  CONSTRAINT pantry_items_notes_chk CHECK (CHAR_LENGTH(notes) <= 120),
  CONSTRAINT pantry_items_version_chk CHECK (version >= 1),
  CONSTRAINT pantry_items_tracking_chk CHECK (tracking IN ('cantidad', 'compras'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Una sola fila (id = 1). El GLOB de SQLite para last_review_date lo hace el
-- tipo DATE, que además rechaza fechas que no existen.
CREATE TABLE pantry_settings (
  id                   INT    NOT NULL,
  monthly_budget_cents BIGINT NULL,
  last_review_date     DATE   NULL,
  PRIMARY KEY (id),
  CONSTRAINT pantry_settings_id_chk CHECK (id = 1),
  CONSTRAINT pantry_settings_budget_chk CHECK (monthly_budget_cents IS NULL OR (monthly_budget_cents >= 0 AND monthly_budget_cents <= 10000000))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

CREATE TABLE pantry_events (
  id         VARCHAR(100) NOT NULL,
  item_id    VARCHAR(100) NOT NULL,
  kind       VARCHAR(10)  NOT NULL,
  event_date DATE         NOT NULL,
  created_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (id),
  KEY pantry_events_item (item_id),
  CONSTRAINT pantry_events_item_fk FOREIGN KEY (item_id) REFERENCES pantry_items (id) ON DELETE CASCADE,
  CONSTRAINT pantry_events_kind_chk CHECK (kind IN ('queda', 'poco', 'se_acabo', 'comprado'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Tickets -------------------------------------------------------------------

-- fingerprint es único. Los tickets nuevos guardan un SHA-256 (64); los de la
-- primera versión de los tickets guardaron «tienda|fecha|hora|total» y se
-- conservan, así que admite 255. import_id y source_fingerprint son únicos
-- cuando tienen valor: un índice único normal admite varios NULL, como el
-- índice parcial de SQLite.
CREATE TABLE pantry_tickets (
  id                 VARCHAR(100) NOT NULL,
  store              VARCHAR(10)  NOT NULL,
  store_name         VARCHAR(60)  NOT NULL,
  address            VARCHAR(120) NOT NULL DEFAULT '',
  purchase_date      DATE         NOT NULL,
  purchase_time      VARCHAR(5)   NULL,
  total_cents        BIGINT       NULL,
  fingerprint        VARCHAR(255) NOT NULL,
  created_at         VARCHAR(40)  NOT NULL,
  adjustments_json   MEDIUMTEXT   NOT NULL DEFAULT ('[]'),
  issues_json        MEDIUMTEXT   NOT NULL DEFAULT ('[]'),
  import_id          VARCHAR(128) NULL,
  source_fingerprint VARCHAR(128) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY pantry_tickets_fingerprint (fingerprint),
  UNIQUE KEY pantry_ticket_import (import_id),
  UNIQUE KEY pantry_ticket_source (source_fingerprint),
  KEY pantry_tickets_date (purchase_date),
  CONSTRAINT pantry_tickets_store_chk CHECK (store IN ('lidl', 'otra')),
  CONSTRAINT pantry_tickets_store_name_chk CHECK (CHAR_LENGTH(TRIM(store_name)) BETWEEN 1 AND 60),
  CONSTRAINT pantry_tickets_address_chk CHECK (CHAR_LENGTH(address) <= 120),
  CONSTRAINT pantry_tickets_total_chk CHECK (total_cents IS NULL OR total_cents BETWEEN -10000000 AND 10000000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- item_id NULL = la línea no se sigue o su producto se borró (SET NULL: la
-- línea se queda). MySQL no deja un CHECK sobre item_id con esa acción, y
-- SQLite tampoco lo tenía.
CREATE TABLE pantry_ticket_lines (
  id                 VARCHAR(100) NOT NULL,
  ticket_id          VARCHAR(100) NOT NULL,
  position           INT          NOT NULL,
  raw_name           VARCHAR(80)  NOT NULL,
  name_key           VARCHAR(240) NOT NULL,
  quantity           INT          NOT NULL,
  unit_price_cents   BIGINT       NULL,
  amount_cents       BIGINT       NULL,
  discount_cents     BIGINT       NOT NULL DEFAULT 0,
  weight_kg          DECIMAL(7,3) NULL,
  price_per_kg_cents BIGINT       NULL,
  tax_code           VARCHAR(1)   NULL,
  item_id            VARCHAR(100) NULL,
  occasional         TINYINT      NOT NULL DEFAULT 0,
  review_status      VARCHAR(10)  NOT NULL DEFAULT 'verified',
  confirmed          TINYINT      NOT NULL DEFAULT 0,
  evidence_json      MEDIUMTEXT   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY pantry_ticket_lines_position (ticket_id, position),
  KEY pantry_ticket_lines_item (item_id),
  CONSTRAINT pantry_ticket_lines_ticket_fk FOREIGN KEY (ticket_id) REFERENCES pantry_tickets (id) ON DELETE CASCADE,
  CONSTRAINT pantry_ticket_lines_item_fk FOREIGN KEY (item_id) REFERENCES pantry_items (id) ON DELETE SET NULL,
  CONSTRAINT pantry_ticket_lines_position_chk CHECK (position >= 0),
  CONSTRAINT pantry_ticket_lines_raw_name_chk CHECK (CHAR_LENGTH(raw_name) BETWEEN 1 AND 80),
  CONSTRAINT pantry_ticket_lines_quantity_chk CHECK (quantity BETWEEN 1 AND 999),
  CONSTRAINT pantry_ticket_lines_unit_price_chk CHECK (unit_price_cents IS NULL OR unit_price_cents >= 0),
  CONSTRAINT pantry_ticket_lines_discount_chk CHECK (discount_cents >= 0),
  CONSTRAINT pantry_ticket_lines_weight_chk CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 1000)),
  CONSTRAINT pantry_ticket_lines_price_per_kg_chk CHECK (price_per_kg_cents IS NULL OR price_per_kg_cents >= 0),
  CONSTRAINT pantry_ticket_lines_tax_code_chk CHECK (tax_code IS NULL OR tax_code IN ('A', 'B', 'C')),
  CONSTRAINT pantry_ticket_lines_occasional_chk CHECK (occasional IN (0, 1)),
  CONSTRAINT pantry_ticket_lines_review_status_chk CHECK (review_status IN ('verified', 'pending')),
  CONSTRAINT pantry_ticket_lines_confirmed_chk CHECK (confirmed IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Lo aprendido por tienda («lidl» u «otra:<NOMBRE>», hasta 5 + 180). item_id
-- NULL e ignored = 1: ese nombre no se sigue. CASCADE sí admite el CHECK.
CREATE TABLE pantry_aliases (
  store      VARCHAR(185) NOT NULL,
  name_key   VARCHAR(240) NOT NULL,
  item_id    VARCHAR(100) NULL,
  ignored    TINYINT      NOT NULL DEFAULT 0,
  updated_at VARCHAR(40)  NOT NULL,
  PRIMARY KEY (store, name_key),
  KEY pantry_aliases_item (item_id),
  CONSTRAINT pantry_aliases_item_fk FOREIGN KEY (item_id) REFERENCES pantry_items (id) ON DELETE CASCADE,
  CONSTRAINT pantry_aliases_ignored_chk CHECK (ignored IN (0, 1)),
  CONSTRAINT pantry_aliases_item_or_ignored_chk CHECK ((item_id IS NULL) = (ignored = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

-- Bloqueos ------------------------------------------------------------------

-- Una fila por zona que serializa sus escrituras: la operación toma
-- SELECT … FOR UPDATE de su fila como primera sentencia y la suelta al
-- confirmar o deshacer. better-sqlite3 lo hacía sin pedirlo, porque escribía
-- todo en serie. No son datos de la persona: el importador no los copia.
CREATE TABLE app_locks (
  name VARCHAR(40) NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;

INSERT INTO app_locks (name) VALUES ('finance'), ('tickets');
