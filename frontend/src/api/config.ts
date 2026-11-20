/**
 * Resolves and normalizes the backend API base URL for frontend requests.
 *
 * Precedence:
 * 1. `import.meta.env.VITE_API_URL`
 * 2. `import.meta.env.VITE_API_BASE_URL`
 * 3. Default: `"/api"` (uses Vite dev server proxy to http://localhost:4000)
 *
 * Edge cases handled:
 * - Trims whitespace and trailing slashes (e.g. "http://localhost:4000/api/" -> "http://localhost:4000/api")
 * - If a bare origin is passed (e.g. "http://localhost:4000"), automatically appends "/api"
 *   since all Express backend routes are mounted under "/api".
 */
export function resolveApiBaseUrl(): string {
  const envUrl = (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_API_BASE_URL ||
    "/api"
  ).trim();

  // Strip trailing slashes
  let url = envUrl.replace(/\/+$/, "");

  // If user passed bare protocol + host without any path (e.g. "http://localhost:4000"),
  // automatically append the "/api" prefix
  if (/^https?:\/\/[^/]+$/.test(url)) {
    url = `${url}/api`;
  }

  return url;
}

export const BASE_URL = resolveApiBaseUrl();
