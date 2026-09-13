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

const LoginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const nextPath = searchParams.get('next');
  const safeNextPath = nextPath?.startsWith('/') && !nextPath.startsWith('//') ? nextPath : null;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(LoginSchema) });

  async function onSubmit(data: LoginForm) {
    setServerError(null);
    try {
      const result = await auth.login(data.email, data.password);
      saveSession(result.token, result.user);
      router.push(safeNextPath ?? getPostAuthRedirect(result.user));
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/trace-logo.png" alt="TRACE" className="mx-auto h-24 w-24" />
        </div>
        <div className="trace-showcase-only rounded-lg border border-amber-200 bg-white p-6 text-center">
          <h1 className="text-xl font-semibold">Read-only research showcase</h1>
          <p className="mt-2 text-sm text-gray-600">
            Sign-in is disabled here. You can explore the synthetic marketplace and public material
            passports.
          </p>
          <Link href="/marketplace" className="mt-4 inline-block text-brand-600 underline">
            Browse marketplace
          </Link>
        </div>
        <Card className="trace-self-hosted-only">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Access TRACE with your email and password</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                  autoComplete="current-password"
                  {...register('password')}
                />
                {errors.password && (
                  <p className="text-sm text-red-500">{errors.password.message}</p>
                )}
              </div>
              {serverError && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">
                  {serverError}
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Signing in…' : 'Sign in'}
              </Button>
              <p className="text-center text-sm text-gray-500">
                New to TRACE?{' '}
                <Link
                  href={
                    safeNextPath
                      ? `/register?next=${encodeURIComponent(safeNextPath)}`
                      : '/register'
                  }
                  className="text-brand-600 underline"
                >
                  Create an account
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
