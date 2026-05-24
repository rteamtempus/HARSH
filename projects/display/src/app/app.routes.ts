import { Routes } from '@angular/router';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'sign-in',
    loadComponent: () => import('./sign-in/sign-in.component').then((m) => m.DisplaySignInComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./board/board.component').then((m) => m.BoardComponent),
  },
  { path: '**', redirectTo: '' },
];
