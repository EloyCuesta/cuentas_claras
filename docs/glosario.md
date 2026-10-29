# Glosario

Lo que ve la persona en la interfaz, cómo se llama en el código y qué es.

| En la interfaz | En el código | Qué es |
| --- | --- | --- |
| Movimiento | `Movement` | Un ingreso o un gasto, realizado o pendiente. |
| Ingreso / Gasto | `MovementType`: `ingreso` / `gasto` | El tipo de un movimiento, una categoría o un recurrente. El importe siempre es positivo. |
| Pagado, cobrado / Pendiente | `MovementStatus`: `realizado` / `pendiente` | Si ya se pagó (o cobró), con `paidDate`, o si está previsto, con `dueDate`. |
| Categoría, subcategoría | `Category` (`parentId`) | Un nivel de subcategorías (Vivienda › Luz). El presupuesto mensual está en la principal (`budgetCents`). |
| Recurrente | `RecurringRule` | Un pago o cobro que se repite (mensual, trimestral, semestral o anual); con `installments`, una financiación. |
| Vencimiento | occurrence (`recurringId` + `occurrenceDate`) | El movimiento que crea un recurrente para una fecha. No puede existir dos veces. |
| Proyectado | `isProjected`, `projectOccurrences` | Un vencimiento futuro que solo se calcula para la previsión; no se guarda. |
| Fecha excluida | `excludedDates` | Un vencimiento borrado, que no debe volver a crearse. |
| Resumen (Mes / Año) | `Period` (`mensual` / `anual`) | Las plantillas mensual y anual, con los mismos cálculos. |
| Copia de seguridad | backup (`serializeBackup`, `parseBackup`) | El JSON con todas las finanzas (no la despensa). |
| Código de acceso | `CUENTAS_CODIGO`, `checkAccessCode` | El código de la casa que da acceso a las finanzas. |
| Invitado / Con código | `Role`: `invitado` / `admin` | Sin sesión, solo la Despensa; con sesión, todo. |
| Despensa | pantry | Lo que se compra en casa, por persona. |
| Persona | `PantryPerson` | Un apartado de la despensa, no una cuenta de usuario. |
| Producto | `PantryItem` | Algo que se compra en casa, de una persona o compartido. |
| Compartido | `ownerId: null` | Un producto de toda la casa. |
| Por compras / Contando | `tracking`: `compras` / `cantidad` | Si se sigue con los tickets (lo normal) o contando lo que hay con − y +. |
| Cada semana / Cada mes / De vez en cuando | `PantryFrequency`: `semanal` / `mensual` / `ocasional` | Cada cuánto se compra. |
| Revisión: «Queda», «Queda poco», «Se acabó», «Lo he comprado» | `PantryEvent` (`kind`: `queda`, `poco`, `se_acabo`, `comprado`) | Lo que se apunta a mano de un producto, con su fecha. |
| Ritmo de compra, «suele durar» | rhythm (`ItemRhythm`, `pantryRhythm`) | Cuánto dura cada producto, calculado con las compras y las revisiones. |
| Para revisar, «Revisar pronto», «Probablemente se acabó» | `RhythmStatus`: `revisar`, `probablemente_acabado`… | Los avisos del ritmo. |
| Repaso de la semana | review (`pantryReview`, `lastReviewDate`) | Una vez a la semana, producto a producto, lo que puede acabarse. |
| Lista de la compra | `shoppingListItems`, `listaCompraTexto` | Lo que falta, agrupado por persona, para WhatsApp. |
| Marcar todo como comprado / Deshacer | `markPurchased` / `undoPurchase` (`PantryPurchaseChange`, `version`) | Comprar lo de la lista y deshacerlo, salvo que algo haya cambiado después. |
| Presupuesto de la despensa | `monthlyBudgetCents` | Para comparar con la estimación mensual; no toca las finanzas. |
| Ticket | `PantryTicket`, `PantryTicketLine` | Una compra guardada desde su ticket, con sus líneas. |
| Escanear, leer un ticket | `ReadTicket`, `TicketDraft`, `parseTicket` | De las imágenes o el texto al ticket propuesto, sin guardar nada. |
| Leída sin dudas / Confirmada / Sugerida / Pendiente | `LineState`: `comprobado`, `confirmado`, `sugerido`, `pendiente`; en el servidor, `reviewStatus`: `verified` / `pending` | El estado de cada línea en la revisión. Solo las fiables cambian la despensa. |
| Cuadra / No cuadra / Incompleto / Pendiente de confirmar | `TicketCheck.status` | La comprobación del ticket con su total. |
| Lo aprendido | alias (`pantry_aliases`, `AliasRecord`) | Qué producto es cada nombre de ticket en cada tienda. |
| No se sigue | decisión `ignore`, alias con `itemId: null` | Una línea del ticket que no es de la despensa (bolsas…). |
| Para una ocasión | `occasional` | Una compra que no cuenta para el ritmo. |
| Huella del ticket | `fingerprint`, `sourceFingerprint` | Lo que impide guardar el mismo ticket dos veces. |
| Últimas compras | `listTickets` | Los tickets guardados, en la Despensa. |
