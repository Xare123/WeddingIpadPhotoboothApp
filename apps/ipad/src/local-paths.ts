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
