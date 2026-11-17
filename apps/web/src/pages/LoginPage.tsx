import { zodResolver } from '@hookform/resolvers/zod';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { type FormError, toFormError } from '../auth/errors';
import { useSessionStore } from '../auth/SessionContext';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';
import { PasswordField } from '../ui/PasswordField';
import { TextField } from '../ui/TextField';

const route = getRouteApi('/auth/login');

/** Only the shape is checked here; the API decides whether the credentials are right. */
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});
type LoginValues = z.infer<typeof loginSchema>;

const FIELDS = ['email', 'password'] as const;

export function LoginPage() {
  const { redirect, reason } = route.useSearch();
  const session = useSessionStore();
  const [formError, setFormError] = useState<FormError | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (formError?.message) alertRef.current?.focus();
  }, [formError]);

  // On success the session changes and the router moves on to `redirect`.
  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null);
    try {
      await session.login(email, password);
    } catch (error) {
      const result = toFormError(error, FIELDS, {
        unauthorized: 'Email or password is incorrect.',
      });
      for (const [field, message] of Object.entries(result.fields)) {
        setError(field as keyof LoginValues, { message }, { shouldFocus: true });
      }
      setFormError(result);
    }
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[1.625rem] leading-8 font-semibold tracking-[-0.02em]">Welcome back</h1>
        <p className="text-body text-text-secondary">Sign in to see where your money stands.</p>
      </div>

      {reason === 'expired' && !formError && (
        <Alert tone="info">Your session has ended. Sign in again to continue.</Alert>
      )}
      {reason === 'signed-out' && !formError && <Alert tone="success">You’ve signed out.</Alert>}
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
          error={errors.email?.message}
          {...register('email')}
        />
        <PasswordField
          label="Password"
          size="lg"
          autoComplete="current-password"
          error={errors.password?.message}
          {...register('password')}
        />
        <Button type="submit" size="lg" loading={isSubmitting} className="mt-1">
          Sign in
        </Button>
      </form>

      <p className="text-center text-body-small text-text-secondary">
        New to Costly?{' '}
        <Link
          to="/register"
          search={redirect ? { redirect } : {}}
          className="font-medium text-accent-text hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
