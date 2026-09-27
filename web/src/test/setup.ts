import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { installFetchMock } from './fixtures';

// Serve the committed export (dist/imd-deployment.json and dist/abi/*.json) to the app's fetch.
installFetchMock();

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // Remove any injected wallet between tests.
  delete (window as { ethereum?: unknown }).ethereum;
});
