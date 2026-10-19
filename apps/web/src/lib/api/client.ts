import axios from "axios";

// Bound authentication waits, including refresh-before-logout coordination.
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export const api = axios.create({
  // Before deployment, set VITE_API_URL to the real HTTPS API URL
  // (or a same-origin API path with a configured reverse proxy), then rebuild.
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});
