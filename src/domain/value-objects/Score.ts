import { InvalidRatingScoreError } from "../errors/DomainErrors.js";

export class Score {
  public static readonly MIN_SCORE = 1;
  public static readonly MAX_SCORE = 5;

  private readonly _value: number;

  private constructor(value: number) {
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      Number.isNaN(value) ||
      value < Score.MIN_SCORE ||
      value > Score.MAX_SCORE
    ) {
      throw new InvalidRatingScoreError(value);
    }
    this._value = value;
  }

  public static create(value: number): Score {
    return new Score(value);
  }

  public get value(): number {
    return this._value;
  }

  public equals(other: Score): boolean {
    if (!other) return false;
    return this._value === other._value;
  }

  public toString(): string {
    return this._value.toString();
  }
}
