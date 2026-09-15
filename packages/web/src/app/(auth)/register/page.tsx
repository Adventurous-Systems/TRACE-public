'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { auth } from '@/lib/api-client';
import { getPostAuthRedirect, saveSession } from '@/lib/auth';
import { track } from '@/lib/analytics';

const RegisterSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

type RegisterForm = z.infer<typeof RegisterSchema>;

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const nextPath = searchParams.get('next');
  const safeNextPath = nextPath?.startsWith('/') && !nextPath.startsWith('//') ? nextPath : null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(RegisterSchema) });

  async function onSubmit(data: RegisterForm) {
    setServerError(null);
    try {
      const result = await auth.register({
        name: data.name,
        email: data.email,
        password: data.password,
      });
      saveSession(result.token, result.user);
      track('signup', { role: result.user.role });
      router.push(safeNextPath ?? getPostAuthRedirect(result.user));
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Registration failed');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/trace-logo.png" alt="TRACE" className="mx-auto h-24 w-24" />
        </div>
        <div className="trace-showcase-only rounded-lg border border-amber-200 bg-white p-6 text-center">
          <h1 className="text-xl font-semibold">Read-only research showcase</h1>
          <p className="mt-2 text-sm text-gray-600">
            Account creation is disabled here. A separately isolated workspace demo is planned for
            hands-on testing.
          </p>
          <Link href="/marketplace" className="mt-4 inline-block text-brand-600 underline">
            Browse marketplace
          </Link>
        </div>
        <Card className="trace-self-hosted-only">
          <CardHeader>
            <CardTitle>Create account</CardTitle>
            <CardDescription>
              Get started with a buyer account for TRACE marketplace access
            </CardDescription>
            <p className="trace-public-buyer-demo-only rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
              This retained public demo does not send verification or password-recovery email. Use a
              fictitious email address and a password that you do not use elsewhere.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Your name"
                  autoComplete="name"
                  {...register('name')}
                />
                {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  {...register('email')}
                />
                {errors.email && <p className="text-sm text-red-500">{errors.email.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-sm text-red-500">{errors.password.message}</p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirmPassword">Confirm password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                />
                {errors.confirmPassword && (
                  <p className="text-sm text-red-500">{errors.confirmPassword.message}</p>
                )}
              </div>
              {serverError && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                  {serverError}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Creating account…' : 'Create account'}
              </Button>
              <p className="text-center text-sm text-gray-500">
                Already have an account?{' '}
                <Link
                  href={safeNextPath ? `/login?next=${encodeURIComponent(safeNextPath)}` : '/login'}
                  className="text-brand-600 underline"
                >
                  Sign in
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-sm text-gray-500 mt-4">
          <Link href="/" className="hover:underline">
            ← Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
