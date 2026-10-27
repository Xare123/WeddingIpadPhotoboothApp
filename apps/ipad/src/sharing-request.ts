import { QueueRequestFailure, type QueueFailure } from '@wedding-booth/core';
import type { SessionPublicationAssets } from './local-types';
import { readyGuestPage, validateReadyPublication } from './sharing';

// Call only around the actual fetch invocation, after local file/config/body
// preparation. 'network' means fetch failed, not proof of being offline or of
// bytes reaching the server. The original exception is deliberately discarded.
export async function performSharingRequest(operation: QueueFailure['operation'], request: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try { response = await request(); }
  catch { throw new QueueRequestFailure(operation, 'network'); }
  if (!response.ok) {
    const status = response.status;
    const category = status === 401 || status === 403 ? 'authorization' : status === 429 ? 'rate-limited' : status >= 500 ? 'server' : 'http';
    throw new QueueRequestFailure(operation, category, status);
  }
  return response;
}
export async function sharingResponseJson(response: Response, operation: QueueFailure['operation']): Promise<unknown> {
  try { return await response.json(); }
  catch { throw new QueueRequestFailure(operation, 'invalid-response', response.status); }
}
export async function sharingReadyResponse(response: Response, expected: SessionPublicationAssets, origin: string): Promise<unknown> {
  const value = await sharingResponseJson(response, 'ready');
  try {
    validateReadyPublication(value, expected);
    readyGuestPage(value, origin);
  } catch { throw new QueueRequestFailure('ready', 'invalid-response', response.status); }
  return value;
}
