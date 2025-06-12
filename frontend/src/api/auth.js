import { get, post } from './client';

export const getAuthStatus = () => get('/api/auth/status');
export const login = (username, password) =>
  post('/api/auth/login', { username, password });
export const logout = () => post('/api/auth/logout');
export const bootstrap = (username, password, displayName) =>
  post('/api/auth/bootstrap', { username, password, displayName });
