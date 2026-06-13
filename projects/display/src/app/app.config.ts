import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
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
    // Installable PWA so the display can live next to other home-screen apps.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    {
      provide: HARSH_SUPABASE_CONFIG,
      useValue: { url: environment.supabaseUrl, anonKey: environment.supabaseAnonKey },
    },
    // Cloud TTS so the display speaks in a natural Chirp 3 HD voice instead of
    // the robotic browser synth. Falls back to the native synth automatically
    // until GOOGLE_CLOUD_API_KEY is set on the `tts` edge function.
    { provide: TTS_ADAPTER, useClass: GoogleTtsAdapter },
    // LLM adapter — required by BrainDumpService, which the board injects for
    // the shared voice Q&A. Without this the board fails to construct (NG0201).
    { provide: LLM_ADAPTER, useClass: GeminiLlmAdapter },
  ],
};
