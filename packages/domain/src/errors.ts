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
