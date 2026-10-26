export type GlassPreferences = { reduceTransparency: boolean; increasedContrast: boolean; reduceMotion: boolean };
export const conservativeGlassPreferences: GlassPreferences = { reduceTransparency: true, increasedContrast: true, reduceMotion: true };

export function nativeGlassAllowed(input: {
  platform: string; version: string | number; liquidGlass: boolean; apiAvailable: boolean; preferences: GlassPreferences;
}): boolean {
  return input.platform === 'ios' && Number.parseFloat(String(input.version)) >= 26 &&
    input.liquidGlass && input.apiAvailable && !Object.values(input.preferences).some(Boolean);
}

export type PreferencePort = {
  read(name: keyof GlassPreferences): Promise<boolean>;
  subscribe(name: keyof GlassPreferences, listener: (value: boolean) => void): { remove(): void };
};

/** Subscribe before querying; an older async query must never undo a newer OS event. */
export function observeGlassPreferences(port: PreferencePort, changed: (value: GlassPreferences) => void): () => void {
  let alive = true;
  let current = { ...conservativeGlassPreferences };
  const subscriptions = (Object.keys(current) as (keyof GlassPreferences)[]).map(name => {
    let revision = 0;
    const commit = (value: boolean) => {
      if (!alive) return;
      current = { ...current, [name]: value }; changed(current);
    };
    const subscription = port.subscribe(name, value => { revision++; commit(value); });
    const queriedRevision = revision;
    void port.read(name).then(value => { if (queriedRevision === revision) commit(value); }).catch(() => {});
    return subscription;
  });
  return () => { alive = false; subscriptions.forEach(subscription => subscription.remove()); };
}
