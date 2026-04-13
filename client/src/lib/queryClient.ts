import { QueryClient } from "@tanstack/react-query";

const API_BASE =
  typeof window !== "undefined" && (window as any).__PORT_5000__
    ? (window as any).__PORT_5000__
    : "";

async function throwIfNotOk(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status}: ${text}`);
  }
  return res;
}

export async function apiRequest(
  method: string,
  path: string,
  body?: unknown
): Promise<any> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && !API_BASE) {
    throw new Error("Backend not reachable. Open the scanner from inside the Perplexity Computer session, not as a standalone tab.");
  }
  await throwIfNotOk(res);
  return res.json();
}

export function getApiBase() { return API_BASE; }

// Check if backend is reachable (works for both Perplexity proxy and self-hosted)
export async function checkBackendAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/scan/progress`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: async ({ queryKey }) => {
        const [path] = queryKey as [string, ...unknown[]];
        const res = await fetch(`${API_BASE}${path}`);
        await throwIfNotOk(res);
        return res.json();
      },
      staleTime: 30000,
      retry: 1,
    },
  },
});
