export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly payload?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}
