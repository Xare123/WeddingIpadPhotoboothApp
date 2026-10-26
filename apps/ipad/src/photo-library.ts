import * as MediaLibrary from 'expo-media-library/legacy';
import { createPhotoExporter, type PhotoExportOptions } from './photo-export';
import { getLocalSession, updatePhotoExport } from './storage';
import type { ActiveSession, PhotoLibraryCapability } from './local-types';

async function capability(request = false): Promise<PhotoLibraryCapability> {
  try {
    if (!await MediaLibrary.isAvailableAsync()) return { available: false, permission: 'undetermined', canAskAgain: false, writeOnly: true };
    const permission = request ? await MediaLibrary.requestPermissionsAsync(true, ['photo']) : await MediaLibrary.getPermissionsAsync(true, ['photo']);
    return { available: true, permission: permission.granted ? 'granted' : permission.status === 'denied' ? 'denied' : 'undetermined',
      canAskAgain: permission.canAskAgain, writeOnly: true };
  } catch { return { available: false, permission: 'undetermined', canAskAgain: false, writeOnly: true }; }
}
const exporter = createPhotoExporter({ capability: () => capability(), requestAddPermission: () => capability(true),
  save: uri => MediaLibrary.saveToLibraryAsync(uri) }, { get: getLocalSession, update: updatePhotoExport });
export const getPhotoLibraryCapability = () => exporter.capability();
export const exportSessionPhotos = (session: ActiveSession, options: PhotoExportOptions = {}) => exporter.exportSession(session, options);
