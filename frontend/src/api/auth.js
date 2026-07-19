import { get, post } from './client';

export const getAuthStatus = () => get('/api/v2/auth/status');
export const login = (username, password) =>
  post('/api/v2/auth/login', { username, password });
export const logout = async () => {
  const refreshToken = localStorage.getItem('refreshToken') || '';
  return post('/api/v2/auth/logout', refreshToken ? { refreshToken } : {}).catch(() => ({ ok: true }));
};
export const bootstrap = (username, password, displayName) =>
  post('/api/v2/auth/bootstrap', { username, password, displayName });
export const changePassword = (oldPassword, newPassword) =>
  post('/api/v2/auth/change-password', { oldPassword, newPassword });
