import type { ErrorCode, ErrorDetail } from "../notifications/notification.types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "ApiError";
  }
}
