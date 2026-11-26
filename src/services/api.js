const TOKEN_STORAGE_KEY = 'sga_auth_token';
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Ignora falhas de storage em ambientes restritos
  }
}

async function request(path, options = {}) {
  const {
    method = 'GET',
    body,
    headers = {},
    skipAuthRedirect = false,
  } = options;

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${API_BASE}/api${normalizedPath}`;
  const token = getAuthToken();

  const requestHeaders = { ...headers };
  if (token && !requestHeaders.Authorization) {
    requestHeaders.Authorization = `Bearer ${token}`;
  }

  let payload = body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isFormData && typeof body !== 'string') {
    requestHeaders['Content-Type'] = requestHeaders['Content-Type'] || 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: payload,
    credentials: 'include',
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && !skipAuthRedirect && !normalizedPath.startsWith('/auth/')) {
      setAuthToken(null);
      window.dispatchEvent(new CustomEvent('sga:unauthorized'));
    }
    const message = (data && typeof data === 'object' && data.error)
      ? data.error
      : (typeof data === 'string' && data) || `Erro na requisição (HTTP ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  put: (path, body, options) => request(path, { ...options, method: 'PUT', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  delete: (path, body, options) => request(path, { ...options, method: 'DELETE', body }),
  upload: (path, formData, options) => request(path, { ...options, method: 'POST', body: formData }),
};
