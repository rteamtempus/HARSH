import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { GoogleTtsAdapter, HARSH_SUPABASE_CONFIG, TTS_ADAPTER } from 'data-access';

import { routes } from './app.routes';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    {
      provide: HARSH_SUPABASE_CONFIG,
      useValue: { url: environment.supabaseUrl, anonKey: environment.supabaseAnonKey },
    },
    // Cloud TTS so the display speaks in a natural Chirp 3 HD voice instead of
    // the robotic browser synth. Falls back to the native synth automatically
    // until GOOGLE_CLOUD_API_KEY is set on the `tts` edge function.
    { provide: TTS_ADAPTER, useClass: GoogleTtsAdapter },
  ],
};
