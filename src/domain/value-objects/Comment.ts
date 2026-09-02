import { InvalidCommentError } from "../errors/DomainErrors.js";

export class Comment {
  public static readonly MAX_LENGTH = 500;

  private readonly _value?: string;

  private constructor(value?: string | null) {
    if (value === undefined || value === null) {
      this._value = undefined;
      return;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      this._value = undefined;
      return;
    }

    if (trimmed.length > Comment.MAX_LENGTH) {
      throw new InvalidCommentError(Comment.MAX_LENGTH, trimmed.length);
    }

    this._value = trimmed;
  }

  public static create(value?: string | null): Comment {
    return new Comment(value);
  }

  public get value(): string | undefined {
    return this._value;
  }

  public hasValue(): boolean {
    return this._value !== undefined;
  }

  public equals(other: Comment): boolean {
    if (!other) return false;
    return this._value === other._value;
  }

  public toString(): string {
    return this._value ?? "";
  }
}
