import {
  type Account,
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  type AccountType,
  type AmountInputError,
  checkDisplayName,
  DEFAULT_LIQUIDITY,
  DISPLAY_NAME_MAX,
  parseAmdInput,
  serializeMinorUnits,
  type UpdateAccountBody,
} from '@costly/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { z } from 'zod';
import { type FormError, toFormError } from '../../auth/errors';
import { useSessionState } from '../../auth/SessionContext';
import { todayIn } from '../../lib/dates';
import { Alert } from '../../ui/Alert';
import { Button } from '../../ui/Button';
import { CheckboxField } from '../../ui/CheckboxField';
import { Dialog, DialogClose, DialogContent } from '../../ui/Dialog';
import { SelectField } from '../../ui/SelectField';
import { TextField } from '../../ui/TextField';
import { useToast } from '../../ui/Toast';
import { OpeningBalance } from './OpeningBalance';
import { useCreateAccount, useUpdateAccount } from './mutations';

const NAME_ERRORS = {
  empty: 'Enter a name for the account.',
  length: `Use at most ${DISPLAY_NAME_MAX} characters.`,
  characters: 'Remove tabs, line breaks and other invisible characters.',
} as const;

const AMOUNT_ERRORS: Record<AmountInputError, string> = {
  empty: 'Enter the opening balance. Use 0 for an empty account.',
  format: 'Enter an amount such as 150000 or 150,000.50.',
  precision: 'Use at most two decimals.',
  negative: 'Enter a positive amount.',
  range: 'Enter an amount below 10 trillion ֏.',
};

const nameSchema = z.string().superRefine((value, context) => {
  const result = checkDisplayName(value);
  if (!result.ok) context.addIssue({ code: 'custom', message: NAME_ERRORS[result.error] });
});

const editSchema = z.object({
  name: nameSchema,
  type: z.enum(ACCOUNT_TYPES),
  isLiquid: z.boolean(),
});

function createSchema(today: string) {
  return editSchema.extend({
    openingBalance: z.string().superRefine((value, context) => {
      const result = parseAmdInput(value, { allowNegative: true });
      if (!result.ok) context.addIssue({ code: 'custom', message: AMOUNT_ERRORS[result.error] });
    }),
    openingDate: z
      .string()
      .min(1, 'Choose the opening date.')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a full date.')
      .refine((date) => date >= '1900-01-01', 'Choose a date from 1900 on.')
      .refine((date) => date <= today, 'The opening date can’t be in the future.'),
  });
}

/** The opening fields exist only when adding: an edit has none to send. */
type FormValues = z.infer<typeof editSchema> & { openingBalance?: string; openingDate?: string };
const FIELDS = ['name', 'type', 'isLiquid', 'openingBalance', 'openingDate'] as const;

const TYPE_OPTIONS = ACCOUNT_TYPES.map((type) => ({
  value: type,
  label: ACCOUNT_TYPE_LABELS[type],
}));

export interface AccountFormDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The account to edit. Without one, the dialog adds a new account. */
  account?: Account;
  /** Called with the API's answer after a successful save. */
  onSaved?(account: Account): void;
}

/**
 * Adds or edits an account in a drawer. Only name, type and "spendable" can
 * change after creation; the opening balance, date and currency can't
 * (`ledger-accounts.md`), so the edit form shows them without fields.
 */
export function AccountFormDialog({
  open,
  onOpenChange,
  account,
  onSaved,
}: AccountFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="drawer" title={account ? 'Edit account' : 'New account'}>
        <AccountForm
          account={account}
          onSaved={(saved) => {
            onOpenChange(false);
            onSaved?.(saved);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({
  account,
  onSaved,
}: {
  account: Account | undefined;
  onSaved(account: Account): void;
}) {
  const session = useSessionState();
  const timeZone = session.status === 'authenticated' ? session.user.timezone : 'UTC';
  const [today] = useState(() => todayIn(timeZone));
  const create = useCreateAccount();
  const update = useUpdateAccount(account?.id ?? '');
  const toast = useToast();
  const [formError, setFormError] = useState<FormError | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  // On a new account the switch follows the type until the user sets it.
  const liquidChosen = useRef(false);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<FormValues>({
    // Both schemas produce FormValues; the cast joins their two resolver types.
    resolver: zodResolver(account ? editSchema : createSchema(today)) as Resolver<FormValues>,
    defaultValues: account
      ? { name: account.name, type: account.type, isLiquid: account.isLiquid }
      : {
          name: '',
          type: 'checking',
          isLiquid: DEFAULT_LIQUIDITY.checking,
          openingBalance: '',
          openingDate: today,
        },
  });

  const type = watch('type');
  useEffect(() => {
    if (!account && !liquidChosen.current) setValue('isLiquid', DEFAULT_LIQUIDITY[type]);
  }, [account, type, setValue]);

  useEffect(() => {
    if (formError?.message) alertRef.current?.focus();
  }, [formError]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const name = (checkDisplayName(values.name) as { name: string }).name;
    try {
      let saved: Account;
      if (account) {
        const patch: UpdateAccountBody = {};
        if (dirtyFields.name && name !== account.name) patch.name = name;
        if (dirtyFields.type && values.type !== account.type) patch.type = values.type;
        if (dirtyFields.isLiquid && values.isLiquid !== account.isLiquid) {
          patch.isLiquid = values.isLiquid;
        }
        saved = Object.keys(patch).length > 0 ? await update.mutateAsync(patch) : account;
      } else {
        const amount = parseAmdInput(values.openingBalance ?? '', { allowNegative: true });
        saved = await create.mutateAsync({
          name,
          type: values.type,
          isLiquid: values.isLiquid,
          openingBalance: serializeMinorUnits(amount.ok ? amount.minor : 0n),
          openingDate: values.openingDate ?? '',
        });
      }
      toast({ title: account ? 'Changes saved' : 'Account added' });
      onSaved(saved);
    } catch (error) {
      // A new account can only conflict on its name. An edit can also meet
      // an account archived meanwhile, so the API's own sentence is shown.
      const result = toFormError(
        error,
        FIELDS,
        account
          ? {}
          : { conflict: { field: 'name', message: 'You already have an account with this name.' } },
      );
      for (const [field, message] of Object.entries(result.fields)) {
        setError(field as keyof FormValues, { message }, { shouldFocus: true });
      }
      setFormError(result);
    }
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {formError?.message && <Alert ref={alertRef}>{formError.message}</Alert>}

      <TextField
        label="Name"
        autoComplete="off"
        maxLength={DISPLAY_NAME_MAX * 2}
        autoFocus
        hint="Such as the bank and card, or “Cash”."
        error={errors.name?.message}
        {...register('name')}
      />
      <SelectField
        label="Type"
        options={TYPE_OPTIONS}
        error={errors.type?.message}
        {...register('type', {
          setValueAs: (value: string) => value as AccountType,
        })}
      />
      <CheckboxField
        label="Spendable money"
        hint="Counts toward the money you can spend now. Savings usually don’t."
        {...register('isLiquid', {
          onChange: () => {
            liquidChosen.current = true;
          },
        })}
      />

      {account ? (
        <div className="flex flex-col gap-2 rounded-sm bg-subtle p-3">
          <OpeningBalance account={account} />
          <p className="text-body-small text-text-secondary">
            The opening balance and date can’t be changed. If they’re wrong, archive this account
            and add it again.
          </p>
        </div>
      ) : (
        <>
          <TextField
            label="Opening balance"
            inputMode="decimal"
            autoComplete="off"
            suffix="֏"
            hint="What the account held at the start of the opening date. Use a minus for debt, such as a credit card balance."
            error={errors.openingBalance?.message}
            {...register('openingBalance')}
          />
          <TextField
            label="Opening date"
            type="date"
            min="1900-01-01"
            max={today}
            hint="The day you start keeping track. It can’t be changed later."
            error={errors.openingDate?.message}
            {...register('openingDate')}
          />
        </>
      )}

      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" loading={isSubmitting}>
          {account ? 'Save changes' : 'Add account'}
        </Button>
      </div>
    </form>
  );
}
