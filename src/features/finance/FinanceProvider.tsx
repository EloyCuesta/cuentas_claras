import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { todayISO } from '#shared/common/dates.ts'
import { generationHorizon } from '#shared/finance/recurring.ts'
import type { ISODate } from '#shared/common/types.ts'
import type { FinanceData } from '#shared/finance/types.ts'
import { ServerUnavailableError } from '../../api/client.ts'
import { writeThenReload } from './confirmedWrite.ts'
import type { FinanceRepository } from './FinanceRepository.ts'
import { FinanceContext, type FinanceActions, type FinanceContextValue } from './financeContext.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { notifyOtherTabs, onOtherTabChange } from './tabSync.ts'
import { useToast, type ToastTone } from '../../ui/toastContext.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: FinanceData; lastBackupAt: string | null; today: ISODate }

/** Lee todos los datos y la fecha de la última copia. */
async function readAll(repository: FinanceRepository, today: ISODate): Promise<LoadState> {
  const [data, lastBackupAt] = await Promise.all([repository.loadAll(), repository.getMeta('lastBackupAt')])
  return { status: 'ready', data, lastBackupAt, today }
}

/** Lo que se hace al abrir la app: crear los vencimientos que falten y leer los datos. */
async function openApp(repository: FinanceRepository): Promise<LoadState> {
  const today = todayISO()
  await repository.generateOccurrences(generationHorizon(today))
  return readAll(repository, today)
}

/** El aviso cuando una escritura se guardó en el servidor pero la pantalla no se pudo volver a leer. */
const SAVED_BUT_NOT_RELOADED =
  'Se ha guardado, pero la pantalla no se ha podido actualizar. No hace falta repetirlo: vuelve a cargar la página para verlo.'

/** Aviso que puede devolver el paso previo a abrir la app (por ejemplo, la importación de datos). */
export type OpenNotice = { message: string; tone: ToastTone } | null

/**
 * Carga los datos del repositorio, genera los vencimientos al abrir la app y
 * ofrece las acciones a la interfaz. No sabe dónde se guardan los datos: recibe
 * un FinanceRepository cualquiera.
 */
export function FinanceProvider({
  repository,
  beforeOpen,
  children,
}: {
  repository: FinanceRepository
  /** Se ejecuta una sola vez antes de la primera carga (si falla, la app se abre igualmente). */
  beforeOpen?: () => Promise<OpenNotice>
  children: ReactNode
}) {
  const { notify } = useToast()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  // Día para el que se generaron los vencimientos por última vez.
  const generatedFor = useRef<ISODate | null>(null)
  // Promesa del paso previo: compartida para que no se ejecute dos veces a la vez.
  const prepared = useRef<Promise<void> | null>(null)

  const prepare = useCallback(() => {
    if (!beforeOpen) return Promise.resolve()
    prepared.current ??= beforeOpen().then(
      (notice) => {
        if (notice) notify(notice.message, notice.tone)
      },
      (error: unknown) => {
        // Sin servidor no se puede abrir nada: se reintenta junto con la carga.
        if (error instanceof ServerUnavailableError) {
          prepared.current = null
          throw error
        }
        // Cualquier otro fallo se avisa una vez y la app se abre igualmente (los datos siguen en el navegador).
        notify(`No se han podido pasar a la base de datos los datos de este navegador: ${describeStorageError(error)}`, 'error')
      },
    )
    return prepared.current
  }, [beforeOpen, notify])

  const start = useCallback(() => {
    generatedFor.current = todayISO()
    return prepare()
      .then(() => openApp(repository))
      .then(setState, (error: unknown) => {
        generatedFor.current = null
        setState({ status: 'error', message: describeStorageError(error) })
      })
  }, [repository, prepare])

  const reload = useCallback(
    () => readAll(repository, todayISO()).then(setState, () => undefined),
    [repository],
  )

  // Al abrir la app.
  useEffect(() => {
    void start()
  }, [start])

  // Si la pestaña sigue abierta y cambia el día, se generan los nuevos vencimientos.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && generatedFor.current !== todayISO()) void start()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [start])

  // Si otra pestaña cambia datos, esta los vuelve a leer.
  useEffect(() => onOtherTabChange(() => void reload()), [reload])

  const actions = useMemo<FinanceActions>(() => {
    /**
     * Cada escritura: si se confirma, se avisa a las otras pestañas y se releen los datos. Si lo que falla es la relectura,
     * lo guardado ya está en el servidor: la acción no falla (así nadie repite un alta que sí se guardó) y se avisa de que
     * la pantalla no está al día (confirmedWrite.ts).
     */
    const write = <T,>(save: () => Promise<T>) =>
      writeThenReload(
        save,
        async () => {
          notifyOtherTabs()
          setState(await readAll(repository, todayISO()))
        },
        () => notify(SAVED_BUT_NOT_RELOADED, 'warning'),
      )
    return {
      async saveMovement(movement) {
        await write(() => repository.saveMovement(movement))
      },
      async deleteMovement(id) {
        await write(() => repository.deleteMovement(id))
      },
      async saveCategory(category) {
        await write(() => repository.saveCategory(category))
      },
      async deleteCategory(id, replacementId) {
        await write(() => repository.deleteCategory(id, replacementId))
      },
      saveRecurring(rule, { markPastAsPaid }) {
        const today = todayISO()
        return write(() =>
          repository.saveRecurring(rule, {
            horizon: generationHorizon(today),
            markPaidBefore: markPastAsPaid ? today : null,
          }),
        )
      },
      async deleteRecurring(id) {
        await write(() => repository.deleteRecurring(id))
      },
      async replaceAll(data) {
        await write(async () => {
          await repository.replaceAll(data)
          // Como al abrir la app: se crean los vencimientos que falten desde la fecha de la copia.
          await repository.generateOccurrences(generationHorizon(todayISO()))
        })
      },
      async registerBackup() {
        await write(() => repository.setMeta('lastBackupAt', new Date().toISOString()))
      },
    }
  }, [repository, notify])

  const value = useMemo<FinanceContextValue | null>(
    () =>
      state.status === 'ready'
        ? { data: state.data, today: state.today, lastBackupAt: state.lastBackupAt, actions }
        : null,
    [state, actions],
  )

  if (state.status === 'loading') {
    return (
      <div className="splash" role="status">
        <p>Abriendo tus cuentas…</p>
      </div>
    )
  }

  if (state.status === 'error' || value === null) {
    return (
      <div className="splash">
        <div className="splash__card" role="alert">
          <h1>No se pueden abrir los datos</h1>
          {state.status === 'error' && <p>{state.message}</p>}
          <p>Tus datos se guardan en una base de datos MySQL de este equipo, que gestiona el servidor de la aplicación.</p>
          <button type="button" className="btn btn--primary" onClick={() => void start()}>
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
}
