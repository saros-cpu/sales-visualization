import { get, post } from './client';

export const getAuthStatus = () => get('/api/auth/status');
export const login = (username, password) =>
  post('/api/auth/login', { username, password });
export const logout = async () => {
  const refreshToken = localStorage.getItem('refreshToken') || '';
  await post('/api/v2/auth/logout', refreshToken ? { refreshToken } : {}).catch(() => {});
  return post('/api/auth/logout');
};
export const bootstrap = (username, password, displayName) =>
  post('/api/auth/bootstrap', { username, password, displayName });
export const changePassword = (oldPassword, newPassword) =>
  post('/api/auth/change-password', { oldPassword, newPassword });
