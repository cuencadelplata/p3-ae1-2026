import { CustomerId } from "../value-objects/Identifiers.js";

export interface CustomerProps {
  id: CustomerId;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class Customer {
  private readonly _id: CustomerId;
  private readonly _firstName: string;
  private readonly _lastName: string;
  private readonly _email: string;
  private readonly _phoneNumber: string;
  private readonly _isActive: boolean;
  private readonly _createdAt: Date;
  private readonly _updatedAt: Date;

  constructor(props: CustomerProps) {
    this._id = props.id;
    this._firstName = props.firstName;
    this._lastName = props.lastName;
    this._email = props.email;
    this._phoneNumber = props.phoneNumber;
    this._isActive = props.isActive;
    this._createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  public get id(): CustomerId {
    return this._id;
  }

  public get fullName(): string {
    return `${this._firstName} ${this._lastName}`;
  }

  public get email(): string {
    return this._email;
  }

  public get phoneNumber(): string {
    return this._phoneNumber;
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public get createdAt(): Date {
    return this._createdAt;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }
}
