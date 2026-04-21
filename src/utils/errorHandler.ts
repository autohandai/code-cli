/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';

/**
 * Standard error handler for catch blocks.
 * Extracts error message and formats it consistently.
 * 
 * @param error - The caught error (can be Error, string, or unknown)
 * @param fallbackMessage - Default message if error has no message
 * @returns Formatted error message
 */
export function formatErrorMessage(
  error: unknown,
  fallbackMessage: string = 'Command failed'
): string {
  if (error instanceof Error) {
    return error.message || fallbackMessage;
  }
  if (typeof error === 'string') {
    return error || fallbackMessage;
  }
  return fallbackMessage;
}

/**
 * Creates a standardized error handler for promise catch blocks.
 * Useful for consistent error handling across the codebase.
 * 
 * @param routeOutput - Function to route the error output
 * @param routeOpts - Optional routing options
 * @param fallbackMessage - Default message if error has no message
 * @returns Error handler function for .catch()
 * 
 * @example
 * ```typescript
 * somePromise
 *   .then(result => { ... })
 *   .catch(createErrorHandler(routeOutput, routeOpts));
 * ```
 */
export function createErrorHandler(
  routeOutput: (output: string) => void,
  fallbackMessage: string = 'Command failed'
): (error: unknown) => void {
  return (error: unknown) => {
    const message = formatErrorMessage(error, fallbackMessage);
    routeOutput(chalk.red(message));
  };
}

/**
 * Wraps an async function with standardized error handling.
 * Returns a function that catches errors and returns null on failure.
 * 
 * @param fn - Async function to wrap
 * @param onError - Optional error callback
 * @returns Wrapped function that never throws
 * 
 * @example
 * ```typescript
 * const safeRead = withErrorHandling(readFile, (err) => console.error(err));
 * const content = await safeRead('test.txt'); // Returns string | null
 * ```
 */
export function withErrorHandling<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  onError?: (error: Error) => void
): (...args: Args) => Promise<T | null> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (onError) {
        onError(error instanceof Error ? error : new Error(String(error)));
      }
      return null;
    }
  };
}