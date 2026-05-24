import { ApplicationConfig, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import {
  GeminiLlmAdapter,
  GoogleTtsAdapter,
  HARSH_SUPABASE_CONFIG,
  LLM_ADAPTER,
  TTS_ADAPTER,
} from 'data-access';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: HARSH_SUPABASE_CONFIG,
      useValue: { url: environment.supabaseUrl, anonKey: environment.supabaseAnonKey },
    },
    { provide: LLM_ADAPTER, useClass: GeminiLlmAdapter },
    { provide: TTS_ADAPTER, useClass: GoogleTtsAdapter },
  ],
};
