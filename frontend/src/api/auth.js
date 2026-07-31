import { ApiPaths } from '@shared/api-contracts';
import { get, post } from './client';

export const getAuthStatus = () => get(ApiPaths.auth.status);
export const login = (username, password) =>
  post(ApiPaths.auth.login, { username, password });
export const logout = async () => {
  const refreshToken = localStorage.getItem('refreshToken') || '';
  return post(ApiPaths.auth.logout, refreshToken ? { refreshToken } : {}).catch(() => ({ ok: true }));
};
export const bootstrap = (username, password, displayName) =>
  post(ApiPaths.auth.bootstrap, { username, password, displayName });
export const changePassword = (oldPassword, newPassword) =>
  post(ApiPaths.auth.changePassword, { oldPassword, newPassword });
