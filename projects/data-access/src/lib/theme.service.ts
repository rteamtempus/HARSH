import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'dark' | 'light';
export type DisplayMode = 'default' | 'wall';

/** Known theme packs. Add to this list whenever a new pack CSS file is registered in angular.json. */
export const THEME_PACKS = ['double-jaded'] as const;
export type ThemePack = (typeof THEME_PACKS)[number];

const STORAGE_KEY = 'harsh.theme';

interface ThemeState {
  pack: ThemePack;
  mode: ThemeMode;
  display: DisplayMode;
}

const DEFAULTS: ThemeState = { pack: 'double-jaded', mode: 'light', display: 'default' };

/**
 * Reads CSS custom properties off <html> and lets you swap which theme pack
 * is active, plus dark/light and the wall-display size modifier.
 *
 * Per-family persistence lives in families.settings.theme — load it once you
 * know which family the current user belongs to and call apply() with it.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly state = signal<ThemeState>(this.read());

  constructor() {
    this.apply(this.state());
  }

  toggleMode(): void {
    this.apply({ mode: this.state().mode === 'dark' ? 'light' : 'dark' });
  }

  apply(next: Partial<ThemeState>): void {
    const merged = { ...this.state(), ...next };
    this.state.set(merged);
    const root = document.documentElement;
    root.dataset['themePack'] = merged.pack;
    root.dataset['theme'] = merged.mode;
    root.dataset['mode'] = merged.display;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* ignore (private mode, etc) */
    }
  }

  private read(): ThemeState {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      const parsed = JSON.parse(raw) as Partial<ThemeState>;
      return {
        pack: THEME_PACKS.includes(parsed.pack as ThemePack) ? (parsed.pack as ThemePack) : DEFAULTS.pack,
        mode: parsed.mode === 'dark' ? 'dark' : 'light',
        display: parsed.display === 'wall' ? 'wall' : 'default',
      };
    } catch {
      return { ...DEFAULTS };
    }
  }
}
