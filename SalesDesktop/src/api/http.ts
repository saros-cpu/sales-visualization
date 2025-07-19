import axios, { AxiosInstance, AxiosError } from 'axios';

const API_HOST = 'http://198.51.100.10:8080';

export function createApi(basePath: string): AxiosInstance {
  const instance = axios.create({
    baseURL: `${API_HOST}${basePath}`,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  instance.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      if (err.response?.status === 401) {
        localStorage.removeItem('accessToken');
        if (window.location.hash !== '#/login') window.location.hash = '#/login';
      }
      const body = err.response?.data as Record<string, unknown> | undefined;
      if (body?.message) {
        return Promise.reject(new Error(String(body.message)));
      }
      return Promise.reject(err);
    }
  );

  return instance;
}

export default createApi;
