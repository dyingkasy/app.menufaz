type ClientErrorPayload = {
  level?: 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const STORAGE_PREFIX = 'menufaz_';
const CURRENT_USER_KEY = `${STORAGE_PREFIX}current_user`;

const getStoredUserId = () => {
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    const user = JSON.parse(raw) as { uid?: string };
    return user?.uid || null;
  } catch {
    return null;
  }
};

const safeSerialize = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
};

const logQueue: ClientErrorPayload[] = [];
let isFlushing = false;

export const logClientError = async (payload: ClientErrorPayload) => {
  if (!API_BASE_URL) return;
  logQueue.push(payload);
  if (isFlushing) return;
  isFlushing = true;

  while (logQueue.length > 0) {
    const next = logQueue.shift();
    if (!next) continue;
    const context = {
      ...next.context,
      url: window.location.href,
      userAgent: navigator.userAgent,
      userId: getStoredUserId()
    };

    try {
      await fetch(`${API_BASE_URL}/logs/client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...next, context })
      });
    } catch {
      // Avoid recursive logging on transport failures.
    }
  }
  isFlushing = false;
};

export const initClientErrorLogging = () => {
  if (typeof window === 'undefined') return;

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== window) {
        const tagName = target.tagName || 'unknown';
        const resource =
          (target as HTMLScriptElement).src ||
          (target as HTMLLinkElement).href ||
          (target as HTMLImageElement).src ||
          '';
        logClientError({
          level: 'error',
          message: 'Resource failed to load',
          context: { tagName, resource }
        });
        return;
      }

      if (event instanceof ErrorEvent) {
        logClientError({
          message: event.message || 'Script error',
          stack: event.error?.stack,
          context: {
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
          }
        });
      }
    },
    true
  );

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as any;
    logClientError({
      message: reason?.message || String(reason || 'Unhandled promise rejection'),
      stack: reason?.stack,
      context: {
        reason: typeof reason === 'string' ? reason : safeSerialize(reason)
      }
    });
  });

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const errorArg = args.find((arg) => arg instanceof Error) as Error | undefined;
    const message = errorArg?.message || (typeof args[0] === 'string' ? String(args[0]) : 'Console error');

    logClientError({
      message,
      stack: errorArg?.stack,
      context: {
        args: args.map(safeSerialize)
      }
    });

    originalConsoleError(...args);
  };

  const originalConsoleWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const firstArg = args[0];
    if (typeof firstArg === 'string') {
      const normalized = firstArg.replace(/\s+/g, ' ').trim();
      if (/The width\(-?\d+\) and height\(-?\d+\) of chart should be greater than 0/.test(normalized)) {
        return;
      }
    }
    logClientError({
      level: 'warning',
      message: typeof args[0] === 'string' ? String(args[0]) : 'Console warning',
      context: { args: args.map(safeSerialize) }
    });
    originalConsoleWarn(...args);
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const [input, init] = args;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input);
    const method =
      (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (url.includes('/logs/client')) {
      return originalFetch(...args);
    }

    try {
      const response = await originalFetch(...args);
      if (!response.ok) {
        logClientError({
          level: response.status >= 500 ? 'error' : 'warning',
          message: `Fetch ${response.status} ${response.statusText || 'error'}`,
          context: { url, method, status: response.status }
        });
      }
      return response;
    } catch (error: any) {
      logClientError({
        message: error?.message || 'Fetch failed',
        stack: error?.stack,
        context: { url, method }
      });
      throw error;
    }
  };

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    (this as any).__logMeta = { method: String(method).toUpperCase(), url: String(url) };
    return originalXHROpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    const meta = (this as any).__logMeta || { method: 'GET', url: '' };
    if (meta.url.includes('/logs/client')) {
      return originalXHRSend.apply(this, args as any);
    }

    this.addEventListener('loadend', () => {
      if (this.status >= 400) {
        logClientError({
          level: this.status >= 500 ? 'error' : 'warning',
          message: `XHR ${this.status}`,
          context: { url: meta.url, method: meta.method, status: this.status }
        });
      }
    });
    this.addEventListener('error', () => {
      logClientError({
        message: 'XHR network error',
        context: { url: meta.url, method: meta.method }
      });
    });
    this.addEventListener('timeout', () => {
      logClientError({
        level: 'warning',
        message: 'XHR timeout',
        context: { url: meta.url, method: meta.method }
      });
    });
    return originalXHRSend.apply(this, args as any);
  };
};
