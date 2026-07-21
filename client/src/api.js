import axios from 'axios';

// Always same-origin: in dev, Vite proxies /api to the backend (see
// vite.config.js); in production, Express serves the built client itself.
export const API = '/api';

const api = axios.create({
  baseURL: API,
  withCredentials: true,
});

export default api;
