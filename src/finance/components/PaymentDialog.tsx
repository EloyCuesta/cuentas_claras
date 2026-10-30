import { useState, type FormEvent } from 'react'
import { formatDate, isValidISODate } from '../../../shared/core/dates.ts'
import { nowISO } from '../../../shared/core/ids.ts'
import { centsToInput, parseAmount } from '../../../shared/core/money.ts'
import type { Movement } from '../../../shared/finance/types.ts'
import { markAsPaid } from '../../../shared/finance/validation.ts'
import { describeStorageError } from '../../api/storageErrors.ts'
import { Dialog, DialogError } from '../../ui/Dialog.tsx'
import { AmountInput, DateInput, Field } from '../../ui/forms.tsx'
import { focusFirstError } from '../../ui/helpers.ts'
import { useToast } from '../../ui/toastContext.ts'
import { useFinance } from '../financeContext.ts'

/**
 * Confirma que un pago (o cobro) pendiente se ha realizado. Modifica el mismo
 * movimiento, así que nunca aparece dos veces.
 */
export function PaymentDialog({ movement, onClose }: { movement: Movement; onClose: () => void }) {
  const { today, actions } = useFinance()
  const { notify } = useToast()
  const [paidDate, setPaidDate] = useState(today)
  const [amount, setAmount] = useState(centsToInput(movement.amountCents))
  const [errors, setErrors] = useState<{ paidDate?: string; amount?: string }>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const isExpense = movement.type === 'gasto'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaveError(null)
    const parsed = parseAmount(amount)
    const nextErrors: typeof errors = {}
    if (!parsed.ok) nextErrors.amount = parsed.error
    if (!isValidISODate(paidDate)) nextErrors.paidDate = isExpense ? 'Indica la fecha de pago.' : 'Indica la fecha de cobro.'
    if (!parsed.ok || nextErrors.paidDate) {
      setErrors(nextErrors)
      focusFirstError(nextErrors, [
        ['paidDate', 'pay-date'],
        ['amount', 'pay-amount'],
      ])
      return
    }
    setBusy(true)
    try {
      await actions.saveMovement(markAsPaid(movement, paidDate, parsed.cents, nowISO()))
      notify(isExpense ? 'Pago confirmado' : 'Cobro confirmado')
      onClose()
    } catch (error) {
      setSaveError(describeStorageError(error))
      setBusy(false)
    }
  }

  return (
    <Dialog title={isExpense ? 'Confirmar pago' : 'Confirmar cobro'} onClose={onClose} size="alert">
      <form className="dialog__form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="dialog__body">
          <p>
            <strong>{movement.concept}</strong>
            {movement.dueDate ? `, con vencimiento el ${formatDate(movement.dueDate)}.` : '.'}
          </p>
          <Field id="pay-date" label={isExpense ? 'Fecha de pago' : 'Fecha de cobro'} error={errors.paidDate}>
            {(control) => <DateInput control={control} value={paidDate} onChange={setPaidDate} today={today} />}
          </Field>
          <Field
            id="pay-amount"
            label={isExpense ? 'Importe pagado' : 'Importe cobrado'}
            error={errors.amount}
            hint="Cámbialo si el importe final ha sido distinto, por ejemplo en una factura de luz."
          >
            {(control) => <AmountInput control={control} value={amount} onChange={setAmount} />}
          </Field>
          <DialogError message={saveError} />
        </div>
        <div className="dialog__footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy} data-autofocus>
            {isExpense ? 'Marcar como pagado' : 'Marcar como cobrado'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
