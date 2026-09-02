import type { Config } from 'jest';

const config: Config = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.unit.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.integration.test.ts'],
      moduleFileExtensions: ['ts', 'js', 'json'],
    },
  ],
};

export default config;
