import { CreateCustomerRatingUseCase } from "../../../application/use-cases/CreateCustomerRatingUseCase.js";
import {
  DomainError,
  InvalidRatingScoreError,
  InvalidCommentError,
  InvalidUuidError,
  DuplicateTripRatingError,
  CustomerNotFoundError,
  CustomerInactiveError,
  InvalidTripProofError,
} from "../../../domain/errors/DomainErrors.js";
import { createProblemDetails, ProblemDetails } from "../dtos/HttpProblemDetails.js";
import { RatingOutputDTO } from "../../../application/dtos/RatingDTOs.js";

export interface HttpRequest {
  params: Record<string, string>;
  body: Record<string, any>;
  path: string;
}

export interface HttpResponse {
  status: number;
  headers?: Record<string, string>;
  body: RatingOutputDTO | ProblemDetails;
}

export class CustomerRatingController {
  private readonly createRatingUseCase: CreateCustomerRatingUseCase;

  constructor(createRatingUseCase: CreateCustomerRatingUseCase) {
    this.createRatingUseCase = createRatingUseCase;
  }

  /**
   * Endpoint: POST /api/v1/customers/:customerId/ratings
   * RF-2.4: Calificación del conductor emitida por el cliente
   */
  public async handleCreateRating(request: HttpRequest): Promise<HttpResponse> {
    const customerId = request.params?.customerId;
    const { tripId, driverId, score, comment, tripCompletionProof } = request.body ?? {};

    // 1. Validación de campos requeridos a nivel de contrato HTTP
    const validationErrors: Array<{ name: string; reason: string }> = [];

    if (!customerId) {
      validationErrors.push({ name: "customerId", reason: "El parámetro customerId en la ruta es obligatorio." });
    }
    if (!tripId) {
      validationErrors.push({ name: "tripId", reason: "El campo 'tripId' en el cuerpo de la petición es obligatorio." });
    }
    if (!driverId) {
      validationErrors.push({ name: "driverId", reason: "El campo 'driverId' en el cuerpo de la petición es obligatorio." });
    }
    if (score === undefined || score === null) {
      validationErrors.push({ name: "score", reason: "El campo 'score' en el cuerpo de la petición es obligatorio." });
    } else if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
      validationErrors.push({ name: "score", reason: "El campo 'score' debe ser un número entero entre 1 y 5." });
    }

    if (validationErrors.length > 0) {
      return {
        status: 400,
        body: createProblemDetails({
          status: 400,
          title: "Bad Request - Errores de Validación de Entrada",
          detail: "La petición contiene parámetros inválidos o faltantes.",
          instance: request.path,
          code: "VALIDATION_ERROR",
          invalidParams: validationErrors,
        }),
      };
    }

    // 2. Invocación de la capa de aplicación
    try {
      const result = await this.createRatingUseCase.execute({
        customerId,
        tripId,
        driverId,
        score,
        comment,
        tripCompletionProof,
      });

      return {
        status: 201,
        headers: {
          Location: `/api/v1/customers/${customerId}/ratings/${result.id}`,
        },
        body: result,
      };
    } catch (error: any) {
      return this.mapErrorToHttpResponse(error, request.path);
    }
  }

  private mapErrorToHttpResponse(error: Error, path: string): HttpResponse {
    if (error instanceof CustomerNotFoundError) {
      return {
        status: 404,
        body: createProblemDetails({
          status: 404,
          title: "Not Found",
          detail: error.message,
          instance: path,
          code: error.code,
        }),
      };
    }

    if (error instanceof DuplicateTripRatingError) {
      return {
        status: 409,
        body: createProblemDetails({
          status: 409,
          title: "Conflict - Calificación Duplicada",
          detail: error.message,
          instance: path,
          code: error.code,
        }),
      };
    }

    if (error instanceof InvalidRatingScoreError || error instanceof InvalidCommentError || error instanceof InvalidUuidError) {
      return {
        status: 400,
        body: createProblemDetails({
          status: 400,
          title: "Bad Request - Invariante de Dominio Violada",
          detail: error.message,
          instance: path,
          code: (error as DomainError).code,
        }),
      };
    }

    if (error instanceof InvalidTripProofError) {
      return {
        status: 422,
        body: createProblemDetails({
          status: 422,
          title: "Unprocessable Entity - Prueba de Viaje Inválida",
          detail: error.message,
          instance: path,
          code: error.code,
        }),
      };
    }

    if (error instanceof CustomerInactiveError) {
      return {
        status: 403,
        body: createProblemDetails({
          status: 403,
          title: "Forbidden - Cliente Inactivo",
          detail: error.message,
          instance: path,
          code: error.code,
        }),
      };
    }

    // Error no controlado (500)
    return {
      status: 500,
      body: createProblemDetails({
        status: 500,
        title: "Internal Server Error",
        detail: "Ocurrió un error inesperado al procesar la calificación.",
        instance: path,
        code: "INTERNAL_SERVER_ERROR",
      }),
    };
  }
}
