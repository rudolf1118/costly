import { PASSWORD_MAX, PASSWORD_MIN, passwordLength } from '@costly/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type FormError, toFormError } from '../auth/errors';
import { useSessionStore } from '../auth/SessionContext';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/PasswordField';
import { SelectField } from '../ui/SelectField';
import { TextField } from '../ui/TextField';

const route = getRouteApi('/auth/register');

/** The same rules as the API (ADR-0005), so most mistakes never make a round trip. */
const registerSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .max(254, 'Use an email address of at most 254 characters.')
    .pipe(z.email('Enter a full email address, like name@example.com.')),
  password: z
    .string()
    .refine((value) => passwordLength(value) >= PASSWORD_MIN, {
      error: `Use at least ${PASSWORD_MIN} characters.`,
    })
    .refine((value) => passwordLength(value) <= PASSWORD_MAX, {
      error: `Use at most ${PASSWORD_MAX} characters.`,
    }),
  timezone: z.string().min(1, 'Choose your time zone.'),
});
type RegisterValues = z.infer<typeof registerSchema>;

const FIELDS = ['email', 'password', 'timezone'] as const;

/** The browser's own zone, which is almost always right, and every zone it knows. */
function timeZones(): { detected: string; options: { value: string; label: string }[] } {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const known = new Set(Intl.supportedValuesOf('timeZone'));
  known.add(detected);
  const options = [...known]
    .sort()
    .map((zone) => ({ value: zone, label: zone.replace(/_/g, ' ') }));
  return { detected, options };
}

export function RegisterPage() {
  const { redirect } = route.useSearch();
  const session = useSessionStore();
  const zones = useMemo(timeZones, []);
  const [formError, setFormError] = useState<FormError | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { timezone: zones.detected },
  });

  useEffect(() => {
    if (formError?.message) alertRef.current?.focus();
  }, [formError]);

  // On success the session changes and the router moves on.
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await session.register(values);
    } catch (error) {
      const result = toFormError(error, FIELDS, {
        conflict: { field: 'email', message: 'An account with this email already exists.' },
      });
      for (const [field, message] of Object.entries(result.fields)) {
        setError(field as keyof RegisterValues, { message }, { shouldFocus: true });
      }
      setFormError(result);
    }
  });

  const emailTaken = errors.email?.message === 'An account with this email already exists.';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[1.625rem] leading-8 font-semibold tracking-[-0.02em]">
          Create your account
        </h1>
        <p className="text-body text-text-secondary">
          No bank login: you stay in control of what you add.
        </p>
      </div>

      {formError?.message && <Alert ref={alertRef}>{formError.message}</Alert>}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          size="lg"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          error={
            emailTaken ? (
              <>
                An account with this email already exists.{' '}
                <Link
                  to="/login"
                  search={redirect ? { redirect } : {}}
                  className="font-medium underline"
                >
                  Sign in instead
                </Link>
              </>
            ) : (
              errors.email?.message
            )
          }
          {...register('email')}
        />
        <PasswordField
          label="Password"
          size="lg"
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters. A passphrase of a few words works well.`}
          error={errors.password?.message}
          {...register('password')}
        />
        <SelectField
          label="Time zone"
          size="lg"
          hint="Decides where your days and months begin."
          options={zones.options}
          error={errors.timezone?.message}
          {...register('timezone')}
        />
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Create account
        </Button>
      </form>

      <p className="text-center text-body-small text-text-secondary">
        Already have an account?{' '}
        <Link
          to="/login"
          search={redirect ? { redirect } : {}}
          className="font-medium text-accent-text hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
