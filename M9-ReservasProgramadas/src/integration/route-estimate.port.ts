import type { GeoLocation, RouteSnapshot } from '../domain/route-snapshot.js';

export type { GeoLocation, RouteSnapshot };

export interface RouteResolver {
  resolve(origin: string, destination: string): Promise<RouteSnapshot>;
}

export class BlockedRouteResolver implements RouteResolver {
  public async resolve(): Promise<RouteSnapshot> {
    throw new Error('BLOCKED_CONTRACT_M4: no se acordó la fuente de coordenadas y ETA.');
  }
}

// Alias transitorio para implementaciones preparadas durante la primera etapa de AE2.
export type RouteEstimate = RouteSnapshot;
export interface RouteEstimateProvider {
  estimate(origin: string, destination: string): Promise<RouteSnapshot>;
}
