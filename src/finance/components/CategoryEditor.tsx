import { useState, type FormEvent } from 'react'
import { newId } from '../../../shared/core/ids.ts'
import {
  categoryOptions,
  categoryPath,
  childrenOf,
  indexCategories,
  nextOrder,
  topLevelCategories,
  withDescendants,
} from '../../../shared/finance/categories.ts'
import type { Category, MovementType } from '../../../shared/finance/types.ts'
import { MAX_CATEGORY_NAME_LENGTH, validateCategoryName } from '../../../shared/finance/validation.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { Dialog, DialogError } from '../../ui/Dialog.tsx'
import { Segmented } from '../../ui/forms.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { useToast } from '../../ui/toastContext.ts'
import { useFinance } from '../financeContext.ts'

type Editing = { mode: 'rename'; category: Category } | { mode: 'add'; parentId: string | null } | null

/** Formulario en línea para el nombre de una categoría. */
function NameForm({
  id,
  label,
  initial,
  validate,
  onSave,
  onCancel,
}: {
  id: string
  label: string
  initial: string
  validate: (name: string) => string | undefined
  onSave: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | undefined>()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const problem = validate(name)
    if (problem) {
      setError(problem)
      return
    }
    void onSave(name.trim())
  }

  return (
    <form className="inline-form" onSubmit={submit} noValidate>
      <div className="field">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="input"
          value={name}
          maxLength={MAX_CATEGORY_NAME_LENGTH}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setError(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onCancel()
            }
          }}
          autoFocus
        />
        {error && (
          <p className="field__error" id={`${id}-error`}>
            {error}
          </p>
        )}
      </div>
      <div className="inline-form__actions">
        <button type="submit" className="btn btn--primary">
          Guardar
        </button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

/** Confirmación para eliminar una categoría, eligiendo a dónde pasan sus movimientos. */
function DeleteCategoryDialog({ category, onClose }: { category: Category; onClose: () => void }) {
  const { data, actions } = useFinance()
  const { notify } = useToast()
  const removed = new Set(withDescendants(data.categories, category.id))
  const children = childrenOf(data.categories, category.id)
  const movementCount = data.movements.filter((m) => removed.has(m.categoryId)).length
  const ruleCount = data.recurring.filter((r) => removed.has(r.categoryId)).length
  const used = movementCount + ruleCount > 0
  const replacements = categoryOptions(data.categories, category.type).filter((o) => !removed.has(o.id))
  const isLastTopLevel = category.parentId === null && topLevelCategories(data.categories, category.type).length === 1
  const fallback =
    category.parentId ?? replacements.find((o) => !o.isChild && /^otros/i.test(o.label))?.id ?? replacements[0]?.id ?? ''
  const [replacementId, setReplacementId] = useState(fallback)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const confirm = async () => {
    setBusy(true)
    try {
      await actions.deleteCategory(category.id, used ? replacementId : null)
      notify(`Categoría «${category.name}» eliminada`)
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  const blocked = isLastTopLevel || (used && replacements.length === 0)

  return (
    <Dialog title={`Eliminar «${category.name}»`} onClose={onClose} size="alert">
      <div className="dialog__body">
        {blocked ? (
          <p>
            Debe quedar al menos una categoría de {category.type === 'gasto' ? 'gastos' : 'ingresos'}. Crea otra antes de
            eliminar esta.
          </p>
        ) : (
          <>
            {children.length > 0 && <p>También se eliminarán sus subcategorías: {children.map((c) => c.name).join(', ')}.</p>}
            {used ? (
              <>
                <p>
                  Tiene {movementCount} {movementCount === 1 ? 'movimiento' : 'movimientos'}
                  {ruleCount > 0 ? ` y ${ruleCount} ${ruleCount === 1 ? 'recurrente' : 'recurrentes'}` : ''}. Elige a qué
                  categoría pasan:
                </p>
                <div className="field">
                  <label className="field__label" htmlFor="delete-category-target">
                    Pasar a
                  </label>
                  <select
                    id="delete-category-target"
                    className="select"
                    value={replacementId}
                    onChange={(event) => setReplacementId(event.target.value)}
                  >
                    {replacements.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            ) : (
              <p>No tiene movimientos. Esta acción no se puede deshacer.</p>
            )}
          </>
        )}
        <DialogError message={saveError} />
      </div>
      <div className="dialog__footer">
        <button type="button" className="btn" onClick={onClose} data-autofocus>
          {blocked ? 'Entendido' : 'Cancelar'}
        </button>
        {!blocked && (
          <button type="button" className="btn btn--danger-solid" onClick={() => void confirm()} disabled={busy}>
            Eliminar categoría
          </button>
        )}
      </div>
    </Dialog>
  )
}

/** Lista editable de categorías y subcategorías. */
export function CategoryEditor() {
  const { data, actions } = useFinance()
  const { notify } = useToast()
  const [type, setType] = useState<MovementType>('gasto')
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<Category | null>(null)
  const parents = topLevelCategories(data.categories, type)

  const rename = async (category: Category, name: string) => {
    try {
      await actions.saveCategory({ ...category, name })
      notify('Categoría renombrada')
      setEditing(null)
    } catch (error) {
      notify(describeStorageError(error), 'error')
    }
  }

  const add = async (parentId: string | null, name: string) => {
    try {
      await actions.saveCategory({
        id: newId(),
        name,
        type,
        parentId,
        order: nextOrder(data.categories, type, parentId),
        budgetCents: null,
      })
      notify(parentId ? 'Subcategoría añadida' : 'Categoría añadida')
      setEditing(null)
    } catch (error) {
      notify(describeStorageError(error), 'error')
    }
  }

  const line = (category: Category, isChild: boolean) => {
    // Nombre completo para los lectores de pantalla: hay subcategorías con nombres repetidos ("Seguros › Otros").
    const fullName = isChild ? categoryPath(category.id, indexCategories(data.categories)) : category.name
    if (editing?.mode === 'rename' && editing.category.id === category.id) {
      return (
        <NameForm
          id={`rename-${category.id}`}
          label={`Nuevo nombre para «${category.name}»`}
          initial={category.name}
          validate={(name) =>
            validateCategoryName(name, data.categories, { type, parentId: category.parentId, excludeId: category.id })
          }
          onSave={(name) => rename(category, name)}
          onCancel={() => setEditing(null)}
        />
      )
    }
    return (
      <div className={`cat-line${isChild ? ' cat-line--child' : ''}`}>
        <span className="cat-line__name">{category.name}</span>
        <span className="cat-line__actions">
          {!isChild && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Añadir subcategoría a ${category.name}`}
              title="Añadir subcategoría"
              onClick={() => setEditing({ mode: 'add', parentId: category.id })}
            >
              <Icon name="plus" />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Renombrar ${fullName}`}
            title="Renombrar"
            onClick={() => setEditing({ mode: 'rename', category })}
          >
            <Icon name="pencil" />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            aria-label={`Eliminar ${fullName}`}
            title="Eliminar"
            onClick={() => setDeleting(category)}
          >
            <Icon name="trash" />
          </button>
        </span>
      </div>
    )
  }

  return (
    <section className="sheet stack" aria-labelledby="categories-title">
      <h2 id="categories-title" className="section-title">
        Categorías
      </h2>
      <p className="muted">
        Las subcategorías sirven para afinar, por ejemplo Vivienda › Luz. El gráfico y los presupuestos suman cada categoría
        principal con sus subcategorías.
      </p>
      <Segmented
        name="categories-type"
        legend="Mostrar categorías de"
        value={type}
        onChange={(value) => {
          setType(value)
          setEditing(null)
        }}
        options={[
          { value: 'gasto', label: 'Gastos' },
          { value: 'ingreso', label: 'Ingresos' },
        ]}
      />
      <ul className="cat-list">
        {parents.map((parent) => {
          const children = childrenOf(data.categories, parent.id)
          const addingHere = editing?.mode === 'add' && editing.parentId === parent.id
          return (
            <li key={parent.id} className="cat-item">
              {line(parent, false)}
              {(children.length > 0 || addingHere) && (
                <ul className="cat-list cat-list--children">
                  {children.map((child) => (
                    <li key={child.id}>{line(child, true)}</li>
                  ))}
                  {addingHere && (
                    <li>
                      <NameForm
                        id={`add-${parent.id}`}
                        label={`Nueva subcategoría de ${parent.name}`}
                        initial=""
                        validate={(name) => validateCategoryName(name, data.categories, { type, parentId: parent.id })}
                        onSave={(name) => add(parent.id, name)}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {editing?.mode === 'add' && editing.parentId === null ? (
        <NameForm
          id="add-top-level"
          label={`Nueva categoría de ${type === 'gasto' ? 'gastos' : 'ingresos'}`}
          initial=""
          validate={(name) => validateCategoryName(name, data.categories, { type, parentId: null })}
          onSave={(name) => add(null, name)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setEditing({ mode: 'add', parentId: null })}>
            <Icon name="plus" />
            Añadir categoría
          </button>
        </div>
      )}
      {deleting && <DeleteCategoryDialog category={deleting} onClose={() => setDeleting(null)} />}
    </section>
  )
}
