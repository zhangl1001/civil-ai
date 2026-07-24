export const ErrorCategory = {
  Validation: 'validation',
  Conflict: 'conflict',
  NotFound: 'not_found',
  Provider: 'provider',
  Storage: 'storage',
  Permission: 'permission',
  Cancelled: 'cancelled'
} as const;

export type ErrorCategory = typeof ErrorCategory[keyof typeof ErrorCategory];

export interface ApplicationErrorOptions {
  code: string;
  category: ErrorCategory;
  retryable?: boolean;
  userMessageKey: string;
  details?: Readonly<Record<string, unknown>>;
  causeId?: string;
  cause?: unknown;
}

export class ApplicationError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly userMessageKey: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly causeId?: string;

  constructor(options: ApplicationErrorOptions) {
    super(options.code, { cause: options.cause });
    this.name = 'ApplicationError';
    this.code = options.code;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.userMessageKey = options.userMessageKey;
    this.details = options.details;
    this.causeId = options.causeId;
  }
}
