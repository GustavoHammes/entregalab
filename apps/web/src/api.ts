export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  const headers = new Headers(options.headers);
  if (options.body != null) headers.set('Content-Type', 'application/json');
  try {
    response = await fetch(`/api${path}`, { ...options, credentials: 'include', headers });
  } catch {
    throw new ApiError('Sem conexao com o servidor. Verifique sua internet e tente novamente.', 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
    const detail = body?.error?.details?.[0];
    throw new ApiError(detail ? `${detail.path}: ${detail.message}` : body?.error?.message ?? 'Nao foi possivel concluir a operacao.', response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export function json(method: string, body: unknown): RequestInit { return { method, body: JSON.stringify(body) }; }
