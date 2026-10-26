export function relativeDocumentPhotoPath(uri: string): string {
  let path = uri;
  if (!path.startsWith('photobooth/')) {
    if (!path.startsWith('file://')) throw new Error('A booth document file is required');
    const match = /\/photobooth\/([A-Za-z0-9_.-]+)$/.exec(path);
    if (!match) throw new Error('A booth document file is required');
    path = `photobooth/${match[1]}`;
  }
  if (!/^photobooth\/[A-Za-z0-9_.-]+$/.test(path) || path.includes('..')) throw new Error('Invalid local photo path');
  return path;
}
export function rebaseDocumentPhotoURI(uri: string, documentURI: string): string {
  return documentURI.replace(/\/$/, '') + '/' + relativeDocumentPhotoPath(uri);
}

// Queue paths belong to the immutable upload identity. A stale container or
// staging suffix can be repaired; another photo's bytes must never be sent.
export function uploadDocumentPhotoPath(photoId: string, uri: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(photoId)) throw new Error('Invalid local upload identity');
  const path = relativeDocumentPhotoPath(uri);
  if (path === `photobooth/${photoId}.partial`) return `photobooth/${photoId}.jpg`;
  if (path !== `photobooth/${photoId}.jpg` && path !== `photobooth/${photoId}.draft.jpg`) throw new Error('Local upload identity mismatch');
  return path;
}
