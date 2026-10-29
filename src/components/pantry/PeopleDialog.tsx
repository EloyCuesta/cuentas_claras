import { useState, type FormEvent } from 'react'
import { PERSON_NAME_MAX } from '#shared/pantry/pantry.ts'
import type { PantryPerson } from '#shared/pantry/types.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { Dialog, DialogError } from '../../ui/Dialog.tsx'
import { Icon } from '../../ui/Icon.tsx'

function PersonRow({
  person,
  onRename,
  onDelete,
}: {
  person: PantryPerson
  onRename: (name: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(person.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = `person-${person.id}`
  const errorId = `${inputId}-error`

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failure) {
      setError(describeStorageError(failure))
    } finally {
      setBusy(false)
    }
  }

  const rename = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('Escribe un nombre.')
      return
    }
    void run(() => onRename(trimmed))
  }

  const changed = name.trim() !== person.name

  return (
    <li className="person-row">
      <form className="person-row__form" onSubmit={rename}>
        <label className="sr-only" htmlFor={inputId}>
          Nombre de {person.name}
        </label>
        <input
          id={inputId}
          className="input"
          maxLength={PERSON_NAME_MAX}
          autoComplete="off"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="btn btn--small" disabled={busy || !changed}>
          Guardar<span className="sr-only"> el nombre de {person.name}</span>
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--danger"
          aria-label={`Eliminar a ${person.name}`}
          disabled={busy}
          onClick={() => void run(onDelete)}
        >
          <Icon name="trash" />
        </button>
      </form>
      {error && (
        <p className="field__error" id={errorId} role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
        </p>
      )}
    </li>
  )
}

/** Personas de casa: añadir, renombrar y borrar. */
export function PeopleDialog({
  people,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: {
  people: readonly PantryPerson[]
  onCreate: (name: string) => Promise<void>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('Escribe el nombre de la persona.')
      document.getElementById('person-new')?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed)
      setName('')
    } catch (failure) {
      setError(describeStorageError(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Personas de casa" onClose={onClose}>
      <div className="dialog__body">
        <p className="muted">Cada persona tiene su apartado, para que sus productos no se mezclen con los compartidos.</p>
        {people.length > 0 ? (
          <ul className="person-list">
            {people.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                onRename={(newName) => onRename(person.id, newName)}
                onDelete={() => onDelete(person.id)}
              />
            ))}
          </ul>
        ) : (
          <p>Todavía no hay nadie. Todo lo que añadas será «Compartido».</p>
        )}
        <form className="person-row__form" onSubmit={(event) => void add(event)} noValidate>
          <label className="sr-only" htmlFor="person-new">
            Nombre de la persona nueva
          </label>
          <input
            id="person-new"
            className="input"
            maxLength={PERSON_NAME_MAX}
            autoComplete="off"
            placeholder="Nombre, por ejemplo Eloy"
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-autofocus
          />
          <button type="submit" className="btn btn--primary" disabled={busy}>
            <Icon name="plus" />
            Añadir persona
          </button>
        </form>
        <DialogError message={error} />
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
    </Dialog>
  )
}
