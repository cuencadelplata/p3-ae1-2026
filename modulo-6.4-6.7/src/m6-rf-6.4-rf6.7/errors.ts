export class ServiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServiceUnavailableError';
  }
}

export class ExternalApiResponseError extends Error {
  constructor(readonly status: number) {
    super(`API externa respondió ${status}`);
    this.name = 'ExternalApiResponseError';
  }
}

export class BadGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadGatewayError';
  }
}