import type { ApiErrorCode } from '@likec4-web-ide/contracts'

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
  }
}
