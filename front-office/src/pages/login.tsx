import { useState, FormEvent } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../contexts/AuthContext';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaRequired, setMfaRequired] = useState(false);
  const [pendingTokens, setPendingTokens] = useState<{ access: string; refresh: string; userId: string; roles: string[] } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail ?? 'Login failed');
        return;
      }
      if (data.mfa_required) {
        setPendingTokens({ access: data.access_token, refresh: data.refresh_token, userId: data.user_id, roles: data.roles });
        setMfaRequired(true);
        return;
      }
      completeLogin(data.access_token, data.user_id, data.roles);
    } catch {
      setError('Cannot reach server. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingTokens) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/v1/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pendingTokens.access}` },
        body: JSON.stringify({ token: mfaToken }),
      });
      if (!res.ok) {
        setError('Invalid MFA code');
        return;
      }
      completeLogin(pendingTokens.access, pendingTokens.userId, pendingTokens.roles);
    } catch {
      setError('MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  const completeLogin = (token: string, userId: string, roles: string[]) => {
    login(token, { id: userId, email, roles, mfa_enabled: mfaRequired });
    router.replace('/');
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[#006B3F] mb-4">
            <span className="text-3xl">🏦</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Ghana Savings &amp; Loans</h1>
          <p className="text-sm text-gray-500 mt-1">Staff Portal — Sign in to continue</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          {!mfaRequired ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@gsl.com.gh"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3F]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#006B3F]"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-[#006B3F] text-white rounded-lg text-sm font-semibold hover:bg-[#005a34] disabled:opacity-50 transition-colors"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="text-center pb-2">
                <div className="text-2xl mb-2">🔐</div>
                <h2 className="text-base font-semibold text-gray-900">Two-Factor Authentication</h2>
                <p className="text-sm text-gray-500 mt-1">Enter the 6-digit code from your authenticator app</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                pattern="\d{6}"
                required
                value={mfaToken}
                onChange={(e) => setMfaToken(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm text-center tracking-widest text-lg focus:outline-none focus:ring-2 focus:ring-[#006B3F]"
              />
              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}
              <button
                type="submit"
                disabled={loading || mfaToken.length < 6}
                className="w-full py-2.5 bg-[#006B3F] text-white rounded-lg text-sm font-semibold hover:bg-[#005a34] disabled:opacity-50 transition-colors"
              >
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => { setMfaRequired(false); setPendingTokens(null); }}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Back to sign in
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Regulated by Bank of Ghana · BoG DCD 2025 · AML Act 1044
        </p>
      </div>
    </main>
  );
}
