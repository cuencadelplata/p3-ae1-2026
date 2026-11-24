export class ServiceUnavailableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ServiceUnavailableError';
    }
}
export class BadGatewayError extends Error {
    constructor(message) {
        super(message);
        this.name = 'BadGatewayError';
    }
}
