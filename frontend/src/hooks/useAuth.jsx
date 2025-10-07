import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getAuthStatus, login as apiLogin, logout as apiLogout } from '../api/auth';
import { clearAuthTokens, storeAuthTokens } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasUsers, setHasUsers] = useState(true);

  // 启动时检查认证状态
  useEffect(() => {
    getAuthStatus()
      .then((data) => {
        setHasUsers(data.hasUsers);
        setUser(data.authenticated ? data.user : null);
        if (data.authenticated) storeAuthTokens(data);
        else clearAuthTokens();
      })
      .catch(() => {
        clearAuthTokens();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiLogin(username, password);
    storeAuthTokens(data);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearAuthTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, hasUsers, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
