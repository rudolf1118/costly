import {
  type Account,
  type AmountInputError,
  type Category,
  DESCRIPTION_MAX,
  formatAmd,
  parseAmdInput,
  serializeMinorUnits,
  type Transaction,
  TRANSACTION_TYPES,
  type TransactionType,
  type UpdateTransactionBody,
} from '@costly/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type FormError, toFormError } from '../../auth/errors';
import { useSessionState } from '../../auth/SessionContext';
import { formatCalendarDate, todayIn } from '../../lib/dates';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { Dialog, DialogClose, DialogContent } from '../../ui/Dialog';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { SelectField } from '../../ui/SelectField';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { categoryLabel } from '../categories/queries';
import { useCreateTransaction, useUpdateTransaction } from './mutations';

const AMOUNT_ERRORS: Record<AmountInputError | 'zero', string> = {
  empty: 'Enter the amount.',
  format: 'Enter an amount such as 4500 or 4,500.50.',
  precision: 'Use at most two decimals.',
  negative: 'Enter the amount without a sign: Income or Expense sets the direction.',
  range: 'Enter an amount below 10 trillion ֏.',
  zero: 'Enter an amount above zero.',
};

const TYPE_OPTIONS = [
  { value: 'expense', label: 'Expense' },
  { value: 'income', label: 'Income' },
] as const;

const FIELDS = ['type', 'accountId', 'categoryId', 'amount', 'occurredOn', 'description'] as const;

interface FormValues {
  type: TransactionType;
  amount: string;
  accountId: string;
  categoryId: string;
  occurredOn: string;
  description: string;
}

/**
 * The form's rules mirror the API's (`ledger-transactions.md`), so most
 * mistakes are explained before anything is sent: a positive amount, a date
 * between the account's opening date and today, a description of at most
 * 255 characters. The API still decides; its answer is shown when it differs.
 */
function formSchema(today: string, accounts: ReadonlyMap<string, Account>) {
  return z
    .object({
      type: z.enum(TRANSACTION_TYPES),
      amount: z.string().superRefine((value, context) => {
        const result = parseAmdInput(value);
        const error = !result.ok ? result.error : result.minor === 0n ? 'zero' : null;
        if (error) context.addIssue({ code: 'custom', message: AMOUNT_ERRORS[error] });
      }),
      accountId: z.string().min(1, 'Choose an account.'),
      categoryId: z.string().min(1, 'Choose a category.'),
      occurredOn: z
        .string()
        .min(1, 'Choose the date.')
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a full date.')
        .refine((date) => date <= today, 'The date can’t be in the future.'),
      description: z
        .string()
        .refine(
          (text) => [...text.normalize('NFC').trim()].length <= DESCRIPTION_MAX,
          `Use at most ${DESCRIPTION_MAX} characters.`,
        )
        .refine(
          (text) => !/[\p{Cc}\p{Cs}]/u.test(text),
          'Remove tabs, line breaks and other invisible characters.',
        ),
    })
    .superRefine((values, context) => {
      const account = accounts.get(values.accountId);
      if (account && values.occurredOn && values.occurredOn < account.openingDate) {
        context.addIssue({
          code: 'custom',
          path: ['occurredOn'],
          message: `The account was opened on ${formatCalendarDate(account.openingDate)}. Choose that day or later.`,
        });
      }
    });
}

export interface TransactionFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The transaction to edit. Without one, the dialog records a new one. */
  transaction?: Transaction;
  /** For a new transaction: income or expense, as chosen by the button that opened it. */
  initialType?: TransactionType;
  /** For a new transaction: the account to preselect, such as the one being filtered. */
  defaultAccountId?: string;
  accounts: Account[];
  categories: Category[];
}

/** Records or edits a transaction in a drawer. */
export function TransactionFormDialog({
  open,
  onOpenChange,
  transaction,
  initialType = 'expense',
  defaultAccountId,
  accounts,
  categories,
}: TransactionFormDialogProps) {
  const title = transaction
    ? 'Edit transaction'
    : initialType === 'income'
      ? 'New income'
      : 'New expense';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="drawer" title={title}>
        <TransactionForm
          // A fresh form for each transaction or each new one.
          key={transaction?.id ?? `new-${initialType}`}
          transaction={transaction}
          initialType={initialType}
          defaultAccountId={defaultAccountId}
          accounts={accounts}
          categories={categories}
          onSaved={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

interface TransactionFormProps {
  transaction: Transaction | undefined;
  initialType: TransactionType;
  defaultAccountId: string | undefined;
  accounts: Account[];
  categories: Category[];
  onSaved(): void;
}

function TransactionForm({
  transaction,
  initialType,
  defaultAccountId,
  accounts,
  categories,
  onSaved,
}: TransactionFormProps) {
  const session = useSessionState();
  const timeZone = session.status === 'authenticated' ? session.user.timezone : 'UTC';
  const [today] = useState(() => todayIn(timeZone));
  const create = useCreateTransaction();
  const update = useUpdateTransaction(transaction?.id ?? '');
  const toast = useToast();
  const [formError, setFormError] = useState<FormError | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const activeAccounts = accounts.filter((account) => account.archivedAt === null);
  const firstAccount =
    (defaultAccountId && accountsById.get(defaultAccountId)?.archivedAt === null
      ? defaultAccountId
      : undefined) ?? activeAccounts[0]?.id;

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema(today, accountsById)),
    defaultValues: transaction
      ? {
          type: transaction.type,
          amount: formatAmd(transaction.amount, { symbol: false }),
          accountId: transaction.accountId,
          categoryId: transaction.categoryId,
          occurredOn: transaction.occurredOn,
          description: transaction.description ?? '',
        }
      : {
          type: initialType,
          amount: '',
          accountId: firstAccount ?? '',
          categoryId: '',
          occurredOn: today,
          description: '',
        },
  });

  const type = watch('type');
  const accountId = watch('accountId');
  const categoryId = watch('categoryId');
  const openingDate = accountsById.get(accountId)?.openingDate;

  // Switching between income and expense clears a category of the other kind.
  useEffect(() => {
    const current = categoriesById.get(categoryId);
    if (current && current.kind !== type) setValue('categoryId', '');
  }, [type, categoryId, categoriesById, setValue]);

  useEffect(() => {
    if (formError?.message) alertRef.current?.focus();
  }, [formError]);

  // Active categories of the chosen kind. An archived category the
  // transaction already has stays selectable: keeping it is allowed.
  const categoryOptions = [
    { value: '', label: 'Choose a category' },
    ...categories
      .filter(
        (category) =>
          category.kind === type &&
          (category.archivedAt === null || category.id === transaction?.categoryId),
      )
      .map((category) => ({
        value: category.id,
        label: `${categoryLabel(category, categoriesById)}${category.archivedAt ? ' (archived)' : ''}`,
      })),
  ];
  const accountOptions = [
    ...(activeAccounts.length === 0 ? [{ value: '', label: 'No active accounts' }] : []),
    ...activeAccounts.map((account) => ({ value: account.id, label: account.name })),
  ];

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const parsed = parseAmdInput(values.amount);
    const amount = serializeMinorUnits(parsed.ok ? parsed.minor : 0n);
    const description = values.description.normalize('NFC').trim();
    try {
      if (transaction) {
        const patch: UpdateTransactionBody = {};
        if (values.type !== transaction.type) patch.type = values.type;
        if (amount !== transaction.amount.toString()) patch.amount = amount;
        if (values.accountId !== transaction.accountId) patch.accountId = values.accountId;
        if (values.categoryId !== transaction.categoryId) patch.categoryId = values.categoryId;
        if (values.occurredOn !== transaction.occurredOn) patch.occurredOn = values.occurredOn;
        if (description !== (transaction.description ?? '')) {
          patch.description = description === '' ? null : description;
        }
        if (Object.keys(patch).length > 0) await update.mutateAsync(patch);
        toast({ title: 'Changes saved' });
      } else {
        await create.mutateAsync({
          type: values.type,
          accountId: values.accountId,
          categoryId: values.categoryId,
          amount,
          occurredOn: values.occurredOn,
          ...(description ? { description } : {}),
        });
        toast({ title: values.type === 'income' ? 'Income added' : 'Expense added' });
      }
      onSaved();
    } catch (error) {
      // A 409 (an account or category archived meanwhile) shows the API's own sentence.
      const result = toFormError(error, FIELDS);
      for (const [field, message] of Object.entries(result.fields)) {
        setError(field as keyof FormValues, { message }, { shouldFocus: true });
      }
      setFormError(result);
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError?.message && <Alert ref={alertRef}>{formError.message}</Alert>}

      <SegmentedControl
        label="Type"
        options={TYPE_OPTIONS}
        value={type}
        onValueChange={(next) => setValue('type', next, { shouldDirty: true })}
      />
      <TextField
        label="Amount"
        inputMode="decimal"
        autoComplete="off"
        autoFocus
        suffix="֏"
        error={errors.amount?.message}
        {...register('amount')}
      />
      <SelectField
        label="Account"
        options={accountOptions}
        error={errors.accountId?.message}
        {...register('accountId')}
      />
      <SelectField
        label="Category"
        options={categoryOptions}
        error={errors.categoryId?.message}
        {...register('categoryId')}
      />
      <TextField
        label="Date"
        type="date"
        min={openingDate}
        max={today}
        error={errors.occurredOn?.message}
        {...register('occurredOn')}
      />
      <TextField
        label="Description"
        autoComplete="off"
        maxLength={DESCRIPTION_MAX * 2}
        hint="Optional, such as where or what for."
        error={errors.description?.message}
        {...register('description')}
      />

      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={isSubmitting}>
          {transaction ? 'Save changes' : type === 'income' ? 'Add income' : 'Add expense'}
        </Button>
      </div>
    </form>
  );
}
