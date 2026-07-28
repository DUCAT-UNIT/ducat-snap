module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@ducat-unit/core/lib$': '<rootDir>/src/__tests__/__mocks__/core-lib.cjs',
    '^@scure/btc-signer$': '<rootDir>/src/__tests__/__mocks__/btc-signer.cjs',
  },
  modulePathIgnorePatterns: ['<rootDir>/dist', '<rootDir>/.snap'],
};
