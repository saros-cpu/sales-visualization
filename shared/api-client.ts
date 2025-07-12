export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export interface AuthAdapter {
  readonly credentials: RequestCredentials;
  getHeaders(): Record<string, string>;
  onUnauthorized(): void;
}

export class CookieAdapter implements AuthAdapter {
  readonly credentials: RequestCredentials = "include";
  getHeaders(): Record<string, string> {
    return {};
  }
  onUnauthorized(): void {
    window.location.href = "/login";
  }
}

export class JwtAdapter implements AuthAdapter {
  readonly credentials: RequestCredentials = "omit";
  private tokenKey = "accessToken";

  getHeaders(): Record<string, string> {
    const token = localStorage.getItem(this.tokenKey);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  onUnauthorized(): void {
    localStorage.removeItem(this.tokenKey);
    if (window.location.hash !== "#/login") {
      window.location.hash = "#/login";
    }
  }
}

export class ApiClient {
  constructor(
    private baseURL: string,
    private auth: AuthAdapter,
  ) {}

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const res = await fetch(url, {
      method,
      credentials: this.auth.credentials,
      headers: {
        "Content-Type": "application/json",
        ...this.auth.getHeaders(),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      this.auth.onUnauthorized();
      throw new Error("Unauthorized");
    }

    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const json = (await res.json()) as ApiResponse<T>;
      // Auto-unwrap: {code, message, data} → data
      // Fallback to json as-is for raw endpoints
      return (json.data ?? json) as T;
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    return res as T;
  }

  get<T = unknown>(path: string, params?: Record<string, string | number | undefined | null>): Promise<T> {
    const qs = params
      ? "?" +
        new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") as [string, string][],
        ).toString()
      : "";
    return this.request<T>("GET", path + qs);
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}
