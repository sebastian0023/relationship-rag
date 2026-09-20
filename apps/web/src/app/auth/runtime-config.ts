import { InjectionToken } from '@angular/core';
import { publicRuntimeConfigSchema, type PublicRuntimeConfig } from '@relationship-rag/contracts';

export const RUNTIME_CONFIG = new InjectionToken<PublicRuntimeConfig | null>('RUNTIME_CONFIG');

export const loadRuntimeConfig = async (): Promise<PublicRuntimeConfig | null> => {
  try {
    const response = await fetch('/assets/runtime-config.json', { cache: 'no-store' });
    if (!response.ok) return null;
    return publicRuntimeConfigSchema.parse(await response.json());
  } catch {
    return null;
  }
};
