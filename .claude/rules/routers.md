---
paths:
  - "server/modules/*/adapters/http/**"
---
# Routers (adaptadores HTTP)
- Solo traducen HTTP ⇄ caso de uso: leer y validar la petición (`valid`, `readBody`, `readDate` o un validador de `shared/`), llamar a un caso de uso y responder con `sendData`.
- Sin SQL y sin reglas de negocio: eso va en application/.
- Errores con `AppError(código, mensaje en español)`; mismas rutas, códigos y mensajes de siempre.
- Lo financiero va en el módulo finance, montado detrás de `requireAdmin`.
- Una ruta nueva va en la tabla «Casos de uso y rutas» del AGENTS.md del módulo y en docs/api.md.
- Detalle: docs/arquitectura.md y docs/api.md
