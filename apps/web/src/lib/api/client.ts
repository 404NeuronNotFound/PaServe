import axios from "axios";

// Bound authentication waits, including refresh-before-logout coordination.
export const AUTH_REQUEST_TIMEOUT_MS = 15_000;

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});
