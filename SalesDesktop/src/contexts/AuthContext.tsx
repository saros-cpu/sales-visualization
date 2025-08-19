import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import client from '@/api/client';
import { clearAuthTokens, refreshAccessToken } from '@/api/http';

interface User {
  id: number;
  username: string;
  displayName?: string;
  role: string;
  roles?: Array<{ id: number; roleCode: string; roleName: string; isPrimary: boolean }>;
  departments?: Array<{ id: number; deptCode: string; deptName: string; isPrimary: boolean }>;
}

export interface PermissionState {
  view: boolean;
  edit: boolean;
}

export type PermissionMap = Record<string, PermissionState>;

interface AuthContextType {
  user: User | null;
  permissions: PermissionMap;
  permissionCodes: string[];
  dataScopes: Record<string, string>;
  loading: boolean;
  can: (permissionCode: string) => boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

function isJwtExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000) + 30;
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<PermissionMap>({});
  const [permissionCodes, setPermissionCodes] = useState<string[]>([]);
  const [dataScopes, setDataScopes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const normalizePermissions = (raw: unknown): PermissionMap => {
    if (Array.isArray(raw)) {
      if (raw.includes('*')) return { '*': { view: true, edit: true } };
      return raw.reduce<PermissionMap>((acc, key) => {
        if (typeof key === 'string') acc[key] = { view: true, edit: false };
        return acc;
      }, {});
    }
    if (!raw || typeof raw !== 'object') return {};
    return Object.entries(raw as Record<string, any>).reduce<PermissionMap>((acc, [key, value]) => {
      if (value === true) acc[key] = { view: true, edit: false };
      else if (value && typeof value === 'object') {
        acc[key] = { view: Boolean(value.view), edit: Boolean(value.edit) };
      }
      return acc;
    }, {});
  };

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        let token = localStorage.getItem('accessToken');
        if (token && isJwtExpired(token)) {
          token = await refreshAccessToken();
        }
        if (!token) return;

        const res = await client.get('/auth/me');
        if (cancelled) return;
        const userData = res.data?.user || res.data;
        if (userData && typeof userData === 'object') {
          userData.roles = res.data?.roles || userData.roles;
          userData.departments = res.data?.departments || userData.departments;
        }
        setUser(userData);
        setPermissions(normalizePermissions(res.data?.permissions));
        setPermissionCodes(Array.isArray(res.data?.permissionCodes) ? res.data.permissionCodes : []);
        setDataScopes(res.data?.dataScopes || {});
      } catch {
        clearAuthTokens();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restoreSession();
    return () => { cancelled = true; };
  }, []);

  const login = async (username: string, password: string) => {
    const res = await client.post('/auth/login', { username, password });
    const {
      accessToken,
      refreshToken,
      user: userData,
      permissions: userPermissions = [],
      permissionCodes: codes = [],
      roles = [],
      departments = [],
      dataScopes: scopes = {},
    } = res.data;
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
    setUser({ ...userData, roles, departments });
    setPermissions(normalizePermissions(userPermissions));
    setPermissionCodes(Array.isArray(codes) ? codes : []);
    setDataScopes(scopes || {});
  };

  const logout = () => {
    client.post('/auth/logout').catch(() => {});
    clearAuthTokens();
    setUser(null);
    setPermissions({});
    setPermissionCodes([]);
    setDataScopes({});
  };

  const can = (permissionCode: string) => {
    if (user?.role === 'admin') return true;
    if (permissionCodes.includes(permissionCode) || permissionCodes.includes('*')) return true;
    const [moduleKey] = permissionCode.split(':');
    return Boolean(moduleKey && permissionCodes.includes(`${moduleKey}:*`));
  };

  return (
    <AuthContext.Provider value={{ user, permissions, permissionCodes, dataScopes, loading, can, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
