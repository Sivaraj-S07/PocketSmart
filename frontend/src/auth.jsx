import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, formatError } from './api.js';

const AuthContext = createContext(null);

/**
 * Session state for the whole app.  The login cookie is HttpOnly, so the browser cannot read
 * it; the user is discovered by asking the API (/api/me).
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, loading: true, reason: null });

  useEffect(() => {
    let cancelled = false;
    api
      .get('/api/me')
      .then((r) => !cancelled && setState({ user: r.ok ? r.data : null, loading: false, reason: null }))
      .catch(() => !cancelled && setState({ user: null, loading: false, reason: null }));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/api/token', { username, password });
    if (!res.ok) return { ok: false, error: typeof res.data?.detail === 'string' ? res.data.detail : formatError(res.data?.detail, 'Invalid username or password') };
    const me = await api.get('/api/me');
    setState({ user: me.ok ? me.data : { username, full_name: null }, loading: false, reason: null });
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    setState((s) => ({ ...s, user: null, reason: 'logout' }));
    try {
      await api.post('/api/logout');
    } catch {
      /* the cookie expires on its own */
    }
  }, []);

  /** Called when the API answers 401 (session expired or revoked). */
  const expireSession = useCallback(() => setState((s) => ({ ...s, user: null, reason: 'expired' })), []);

  const value = useMemo(() => ({ ...state, login, logout, expireSession }), [state, login, logout, expireSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
