import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HARSH_SUPABASE_CONFIG } from 'data-access';

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
  ],
};
