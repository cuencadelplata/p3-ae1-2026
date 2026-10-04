export interface DistributedLock {
  runExclusive<T>(key: string, action: () => Promise<T>): Promise<T>;
}
