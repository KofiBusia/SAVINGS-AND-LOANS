import type { AppProps } from 'next/app';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import '../styles/globals.css';

const PUBLIC_PATHS = ['/login'];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !PUBLIC_PATHS.includes(router.pathname)) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, router.pathname]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#006B3F] flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-5xl mb-4">🏦</div>
          <p className="text-white/70 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !PUBLIC_PATHS.includes(router.pathname)) {
    return null;
  }

  return <>{children}</>;
}

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <AuthGuard>
        <Component {...pageProps} />
      </AuthGuard>
    </AuthProvider>
  );
}
