export class DomainError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class ResourceNotFoundError extends DomainError {
  public constructor() {
    super('RESOURCE_NOT_FOUND', 'The requested resource was not found.');
    this.name = 'ResourceNotFoundError';
  }
}

export class AuthorizationError extends DomainError {
  public constructor() {
    super('FORBIDDEN', 'You are not authorized to access this resource.');
    this.name = 'AuthorizationError';
  }
}

export class ConflictError extends DomainError {
  public constructor() {
    super('CONFLICT', 'This memory has changed. Reload it and try again.');
    this.name = 'ConflictError';
  }
}
