import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () => import('./sign-in/sign-in').then((m) => m.DisplaySignInComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./board/board').then((m) => m.BoardComponent),
  },
  { path: '**', redirectTo: '' },
];
