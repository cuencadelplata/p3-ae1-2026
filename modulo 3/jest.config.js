export default {
  testEnvironment: "node",
  extensionsToTreatAsEsm: [".ts"],
  testMatch: ["<rootDir>/tests/vehiculo/**/*.test.ts"],
  moduleNameMapper: {
    "^(\.{1,2}/.*)\.js$": "$1",
  },
  transform: {
    "^.+\.ts$": [
      "ts-jest",
      {
        useESM: true,
        diagnostics: false,
        tsconfig: {
          module: "esnext",
          target: "es2022",
          moduleResolution: "bundler",
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
