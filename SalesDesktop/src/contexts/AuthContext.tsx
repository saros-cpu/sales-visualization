import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import client from '@/api/client';

interface User {
  id: number;
  username: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) { setLoading(false); return; }
    client.get('/auth/me').then((res) => {
      setUser(res.data.data);
    }).catch(() => {
      localStorage.removeItem('accessToken');
    }).finally(() => setLoading(false));
  }, []);

  const login = async (username: string, password: string) => {
    const res = await client.post('/auth/login', { username, password });
    const { accessToken, user: userData } = res.data.data;
    localStorage.setItem('accessToken', accessToken);
    setUser(userData);
  };

  const logout = () => {
    client.post('/auth/logout').catch(() => {});
    localStorage.removeItem('accessToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
