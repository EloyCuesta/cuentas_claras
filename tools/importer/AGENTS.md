# tools/importer/ — Importador SQLite → MySQL

> Lee antes: /AGENTS.md, `docs/migration/DATA.md` (el contrato y el corte) y `tools/sqlite/AGENTS.md` (la base que lee). Usa la conexión de `server/common/mysql/`.

Pasa una copia de `cuentas.db` (la app con SQLite) a una base MySQL vacía y demuestra, fila a fila, que no se ha perdido ni cambiado nada. Lo ejecuta la persona una vez, en el corte de datos; no forma parte del arranque del servidor.

```bash
npm run importar:sqlite -- "<copia de cuentas.db>" [--informe <archivo.json>]
```

Usa las `CUENTAS_DB_*` del entorno o de `.env` (la base por defecto es `cuentas_claras`); no necesita `CUENTAS_CODIGO`. Necesita better-sqlite3, que es una dependencia de desarrollo: lo instala `npm install`, no `npm install --omit=dev`. Los pasos completos del corte están en el README («Pasar los datos de SQLite a MySQL»).

## Qué hay

| Archivo | Qué es |
| --- | --- |
| `cli.ts` | El comando: argumentos, configuración, informe junto a la copia (o en `--informe`) y código de salida |
| `importSqlite.ts` | La importación entera y el informe (`ImportReport`) |
| `source.ts` | Leer y comprobar la copia: integridad, versión 5, tablas y columnas, referencias; la abre en solo lectura desde un duplicado temporal |
| `columns.ts` | Las columnas de MySQL (information_schema) y si cada valor cabe tal cual |
| `compare.ts` | JSON normalizado por fila, huella por tabla, diferencias y sumas |
| `tables.ts` | Las doce tablas en orden de claves foráneas, con su clave |
| `report.ts` | El archivo del informe, las líneas de la consola y el código de salida |
| `syntheticCopy.ts` | Una copia inventada con las doce tablas y sus casos difíciles, para las pruebas |
| `importSqlite.test.ts` y `cli.test.ts` | Las pruebas, contra MySQL de verdad |

## Reglas que no se rompen

- La copia se abre en **solo lectura**: SQLite lee un duplicado en la carpeta temporal del sistema, así que junto a la copia no aparecen `-wal` ni `-shm`. Un `-wal` con cambios junto a la copia la rechaza (la app no estaba parada).
- Solo carga en una base **vacía** (las doce tablas sin filas; `schema_migrations` y `app_locks` no cuentan) y **no siembra** las categorías iniciales.
- Copia las filas tal cual, con sus ids, versiones, huellas y evidencias, sin pasar por los casos de uso: no repite los efectos de los tickets ni aprende de nuevo.
- Todo en **una transacción**, con los bloqueos `finance` y `tickets`: comprueba que está vacía, carga en orden de claves foráneas, vuelve a leer y compara. Si algo no coincide o falla, se deshace todo y la base queda vacía (con sus tablas).
- Antes de escribir, cada valor se comprueba contra su columna de MySQL: un DECIMAL con decimales de más se redondearía sin avisar, una fecha imposible o un texto largo los rechazaría MySQL.
- Ni la consola ni el informe llevan textos de la persona (conceptos, nombres, notas): solo tablas, claves, columnas, recuentos, huellas y sumas. Ni la contraseña.
- Códigos de salida: **0** importado y comprobado (también tras confirmar, con otra lectura); **1** con diferencias (se deshizo); **2** rechazado o fallido (no se ha importado nada); **3** importado y comprobado, pero el informe no se pudo escribir.
- Solo importa su carpeta, `tools/sqlite/`, `server/common/` y `shared/` (`tests/architecture.test.ts`); nada de los módulos del servidor.

## El informe

JSON (`cuentas-claras-importacion-v1`): `resultado` y `mensaje`; `origen` (archivo, bytes, SHA-256, versión, integridad y referencias); `destino` (usuario@equipo:puerto/base sin la contraseña, versión de MySQL y del esquema); `tablas`, con filas, huella SHA-256 del JSON normalizado, nulos por columna, claves y diferencias (claves que faltan, que sobran o con columnas distintas, sin los valores); `sumas` de la copia y de MySQL (céntimos por tipo, estado y mes, recurrentes, despensa en milésimas y versiones, tickets, líneas y lo aprendido); y `problemas`, si se rechazó.

## Trampas

- El DDL de MySQL se confirma solo: las tablas se crean antes de la transacción de los datos y se quedan aunque la carga se deshaga. Por eso se puede repetir en la misma base, que sigue vacía.
- Los REAL de SQLite pueden traer ruido (0,1 + 0,2): se comparan en milésimas, como DECIMAL(10,3).
- Los enteros se leen como bigint (`safeIntegers`): uno que no cabe en JavaScript se rechaza en vez de perder precisión.
- better-sqlite3 abre cualquier archivo y falla en la primera lectura. Windows no borra un archivo abierto, así que el duplicado se cierra antes de borrar su carpeta también al rechazar una copia que no es SQLite (si no, la persona vería EPERM). Lo comprueba `importSqlite.test.ts`, que mira que la carpeta temporal queda vacía.
- Las pruebas usan `afterTable` para provocar un fallo o una diferencia a mitad de la carga; el comando nunca lo pasa.

## Cómo probar

`npx vitest run tools/importer` (necesita MySQL, como el resto: README, «Pruebas»).

## Si cambias algo aquí

`docs/migration/DATA.md` y el README si cambian el comando, el informe o los pasos del corte. Si cambia una tabla de MySQL (`database/mysql/`), el importador lo nota: rechaza la copia porque sus columnas ya no coinciden.
