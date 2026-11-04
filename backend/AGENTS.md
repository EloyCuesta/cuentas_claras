# backend/ — Migración a ASP.NET Core

> Lee antes: [guía raíz](../AGENTS.md), [convenciones](../docs/convenciones.md), [estado](../docs/migration/STATUS.md) y [arquitectura de migración](../docs/migration/ARCHITECTURE.md).

## Qué hace

BASE-02 aporta el host .NET y el acceso. Express/SQLite sigue siendo la aplicación de uso diario. Este backend no abre SQLite ni incorpora todavía MySQL, finanzas, despensa u OCR. El arranque y las pruebas están en [pruebas](../docs/pruebas.md).

## Acceso

Mismo código, cookie, caducidad y bloqueo que [auth actual](../server/modules/auth/AGENTS.md). Se valida CUENTAS_CODIGO antes de construir el host. Las sesiones y los intentos viven en memoria por host. No hay ruta de reset ni modo de pruebas accesible por HTTP.

## API pública

`src/CuentasClaras.Api/Composition/ApiHost.cs` compone manualmente los adaptadores y casos de uso. Create permite sustituir reloj y comprobación de almacenamiento para pruebas; Program usa adaptadores reales y configuración por entorno.

## Casos de uso y rutas

| Ruta | Caso de uso | Estado |
| --- | --- | --- |
| POST /api/auth/login | Login | Valida cuerpo, limita intentos y sustituye la sesión previa solo tras acertar |
| GET /api/auth/me | CheckSession | admin o invitado; HEAD conserva cabeceras sin cuerpo |
| POST /api/auth/logout | Logout | Siempre éxito; invalida token y cookie |
| GET /api/health | CheckHealth | Consulta IStorageHealth; sin almacenamiento responde 500, nunca inventa una versión |
| Rutas financieras y desconocidas | CheckSession | Sin sesión 401; con sesión 404 mientras no se implemente la ruta |

Las rutas conocidas de despensa/tickets se reservan como públicas pero responden 404 hasta sus entregas. La lista actual sigue en [API](../docs/api.md).

## Puertos

Application posee IClock, IIdGenerator, ISessionStore, IAttemptStore, ICodeVerifier, ITokenGenerator e IStorageHealth. Infrastructure implementa reloj UTC, UUID, memoria, SHA-256 con comparación constante, tokens aleatorios y el fallo explícito por almacenamiento sin configurar. Los tests sustituyen reloj y salud, sin bases de datos.

## Reglas que no se rompen

- Capas y módulos: [arquitectura](../docs/migration/ARCHITECTURE.md). Solo Composition de Api conoce Infrastructure. Composición manual, sin contenedor de aplicación ni ORM.
- Domain solo biblioteca estándar; Application solo Domain. Common no conoce módulos. Los módulos solo conocen el propio y Common; Tickets puede consumir contratos de Application.Pantry.Contracts cuando se implementen.
- C# con nullable y avisos como errores. Mantén los archivos y comentarios en el estilo existente; nombres de tests y comentarios en español.
- Cada host tiene sus almacenes y un Login compartido. Su sección crítica protege la operación completa de intentos y sesiones concurrentes.
- El lector JSON precede al acceso y al router. Cuenta bytes descomprimidos: 30 MiB para lectura de tickets, 20 MiB en el resto. Todos los errores de aplicación usan sobre JSON español y no-store.
- El proxy solo es fiable desde loopback. No sustituyas esa regla por confiar en todas las cabeceras X-Forwarded-For.
- Ninguna dependencia nueva sin preguntar; las referencias de tests y locks existentes se conservan. No se ha elegido proveedor MySQL.
- Nunca leer server/data ni cargar .env automáticamente. La configuración local se pasa por entorno.

## Datos

Solo sesiones e intentos efímeros. IStorageHealth falla en ejecución normal hasta DATA-01. El test que devuelve versión 5 es un adaptador sintético y no acredita una conexión MySQL.

## Pruebas

`tests/CuentasClaras.Tests/AuthTests.cs`: política, casos de uso y adaptadores de acceso.
`tests/CuentasClaras.Tests/HttpTests.cs`: Kestrel real, corpus HTTP compartido, límites, errores, proxy y proceso de arranque.
`tests/CuentasClaras.Tests/ArchitectureTests.cs`: referencias de proyectos/ensamblados y dependencias de tipos e IL entre capas y módulos.
`../e2e/dotnet/auth.spec.ts`: componentes reales React sobre .NET, escritorio/móvil y claro/oscuro.

Los comandos y el alcance exacto están en [pruebas](../docs/pruebas.md). Los resultados de cada tarea van en [STATUS](../docs/migration/STATUS.md).

## Trampas y decisiones

- CUENTAS_PORT usa 3201 por defecto para convivir con Express; puerto 0 se reserva a ensayos con puerto libre.
- La página e2e monta solo acceso: no demuestra finanzas ni despensa sobre .NET.
- No marcar DATA-01 como disponible por existir puertos. Requiere proveedor autorizado, esquema y pruebas reales MySQL.
- Los mensajes históricos que mencionan npm run dev o .env se conservan por compatibilidad. El arranque .NET se configura como indica la documentación de pruebas.

## Si cambias este módulo

Actualiza esta guía, el estado de migración y la API si cambia un contrato; los cambios de arquitectura deben quedar cubiertos por ArchitectureTests. Mantén CLAUDE.md junto a esta guía y pasa las comprobaciones .NET y Node indicadas en la raíz.
