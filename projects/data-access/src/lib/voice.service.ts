import { Injectable, computed, signal } from '@angular/core';

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }
  >;
}
interface SpeechRecognitionErrorEvent extends Event { error: string; message: string }
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEvent) => unknown) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEvent) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const WAKE_RE = /\b(?:hey|hi|ok|okay)?\s*(?:harsh|hash|hersh|harsch|harch|horse|hartz)\b[,.!?:]?\s*(.*)/i;
const VOICE_STORAGE_KEY = 'harsh.voiceName';
/** How long after the last new word before we consider the command finished. */
const SILENCE_MS = 1800;
/** Hard cap on a single command to avoid the user holding the floor forever. */
const MAX_COMMAND_MS = 12000;

type WakeMode = 'idle' | 'command';

@Injectable({ providedIn: 'root' })
export class VoiceService {
  readonly listening = signal(false);
  readonly transcript = signal('');
  readonly wakeArmed = signal(false);
  /** Increments when wake phrase is detected — UI subscribes for chime + flash. */
  readonly wakeCount = signal(0);
  /** True while we're actively capturing the command after the wake word. */
  readonly capturingCommand = signal(false);
  readonly supported = signal(this.detectSupport());

  readonly voices = signal<SpeechSynthesisVoice[]>([]);
  readonly selectedVoiceName = signal<string | null>(this.readStoredVoice());
  readonly selectedVoice = computed<SpeechSynthesisVoice | null>(() => {
    const name = this.selectedVoiceName();
    if (!name) return null;
    return this.voices().find((v) => v.name === name) ?? null;
  });

  private recognition: SpeechRecognitionLike | null = null;
  private wakeWantsRun = false;
  private wakeCallback: ((command: string) => void) | null = null;
  private restartGuard = false;
  private audioCtx: AudioContext | null = null;

  // Wake / command state
  private mode: WakeMode = 'idle';
  private commandText = '';
  private silenceHandle: ReturnType<typeof setTimeout> | null = null;
  private maxHandle: ReturnType<typeof setTimeout> | null = null;
  private lastFinalLen = 0;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const refresh = () => this.voices.set(window.speechSynthesis.getVoices());
      refresh();
      window.speechSynthesis.onvoiceschanged = refresh;
    }
  }

  /** Push-to-talk one-shot. */
  start(): Promise<string> {
    if (!this.supported()) return Promise.reject(new Error('Speech recognition not supported'));
    if (this.listening()) return Promise.reject(new Error('Already listening'));
    const wasWake = this.wakeWantsRun;
    if (wasWake) {
      this.wakeWantsRun = false;
      this.recognition?.abort();
    }

    return new Promise<string>((resolve, reject) => {
      const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!Ctor) { reject(new Error('SpeechRecognition unavailable')); return; }
      const r = new Ctor();
      this.recognition = r;
      r.lang = navigator.language || 'en-US';
      r.continuous = false;
      r.interimResults = true;
      r.maxAlternatives = 1;

      let finalText = '';
      r.onresult = (ev) => {
        let combined = '';
        for (let i = 0; i < ev.results.length; i++) combined += ev.results[i][0].transcript;
        this.transcript.set(combined);
        finalText = combined;
      };
      const cleanup = () => {
        this.listening.set(false);
        this.recognition = null;
        if (wasWake) {
          this.wakeWantsRun = true;
          setTimeout(() => this.spawnWakeRecognition(), 200);
        }
      };
      r.onerror = (ev) => { cleanup(); reject(new Error(ev.error || 'speech error')); };
      r.onend = () => { cleanup(); resolve(finalText.trim()); };

      this.transcript.set('');
      this.listening.set(true);
      r.start();
    });
  }

  stop(): void { this.recognition?.stop(); }

  startWakeWord(onCommand: (command: string) => void): () => void {
    if (!this.supported()) throw new Error('Speech recognition not supported');
    this.wakeWantsRun = true;
    this.wakeCallback = onCommand;
    this.wakeArmed.set(true);
    this.resetCommandState();
    this.spawnWakeRecognition();
    return () => this.stopWakeWord();
  }

  stopWakeWord(): void {
    this.wakeWantsRun = false;
    this.wakeCallback = null;
    this.wakeArmed.set(false);
    this.resetCommandState();
    this.recognition?.abort();
  }

  private resetCommandState(): void {
    this.mode = 'idle';
    this.commandText = '';
    this.capturingCommand.set(false);
    this.lastFinalLen = 0;
    if (this.silenceHandle) { clearTimeout(this.silenceHandle); this.silenceHandle = null; }
    if (this.maxHandle) { clearTimeout(this.maxHandle); this.maxHandle = null; }
  }

  private spawnWakeRecognition(): void {
    if (!this.wakeWantsRun || this.restartGuard) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    this.recognition = r;
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;

    r.onresult = (ev) => {
      let combined = '';
      let anyFinal = false;
      for (let i = 0; i < ev.results.length; i++) {
        combined += ev.results[i][0].transcript;
        if ((ev.results[i] as any).isFinal) anyFinal = true;
      }

      if (this.mode === 'idle') {
        // Look for the wake phrase. Once seen, switch to command mode and start
        // accumulating — don't fire the callback yet.
        const match = combined.match(WAKE_RE);
        if (match) {
          this.mode = 'command';
          this.capturingCommand.set(true);
          this.wakeCount.update((n) => n + 1);
          this.commandText = (match[1] ?? '').trim();
          this.transcript.set(this.commandText);
          this.armSilence(r);
          this.armMaxDuration(r);
        }
      } else {
        // In command mode: strip the wake phrase out of the latest combined
        // string and treat the remainder as the running command.
        const match = combined.match(WAKE_RE);
        const rest = (match?.[1] ?? combined).trim();
        // If the engine produced any new text, treat that as activity.
        if (rest.length !== this.commandText.length || anyFinal) {
          this.commandText = rest;
          this.transcript.set(rest);
          this.armSilence(r);
        }
      }
    };
    r.onerror = (ev) => {
      if (ev.error === 'aborted' || ev.error === 'no-speech') return;
      console.warn('wake-word error:', ev.error);
    };
    r.onend = () => {
      this.recognition = null;
      // If the engine ended while we were capturing, submit whatever we got.
      if (this.mode === 'command' && this.commandText.length >= 2) {
        const cmd = this.commandText;
        this.resetCommandState();
        try { this.wakeCallback?.(cmd); } catch (e) { console.error(e); }
      } else {
        this.resetCommandState();
      }
      this.transcript.set('');
      if (this.wakeWantsRun) {
        this.restartGuard = true;
        setTimeout(() => {
          this.restartGuard = false;
          this.spawnWakeRecognition();
        }, 200);
      }
    };

    try { r.start(); } catch { /* already started */ }
  }

  private armSilence(r: SpeechRecognitionLike): void {
    if (this.silenceHandle) clearTimeout(this.silenceHandle);
    this.silenceHandle = setTimeout(() => {
      // Submit what we've accumulated and let onend handle reset/restart.
      const cmd = this.commandText.trim();
      this.commandText = '';
      try { r.abort(); } catch { /* noop */ }
      if (cmd.length >= 2) {
        const cb = this.wakeCallback;
        this.resetCommandState();
        try { cb?.(cmd); } catch (e) { console.error(e); }
      } else {
        // Too short to be a command — go back to idle without firing.
        this.resetCommandState();
      }
    }, SILENCE_MS);
  }

  private armMaxDuration(r: SpeechRecognitionLike): void {
    if (this.maxHandle) clearTimeout(this.maxHandle);
    this.maxHandle = setTimeout(() => {
      try { r.abort(); } catch { /* noop */ }
    }, MAX_COMMAND_MS);
  }

  playChime(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = this.audioCtx!;
      if (ctx.state === 'suspended') ctx.resume();
      const tone = (freq: number, start: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t0 = ctx.currentTime + start;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(0.18, t0 + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      };
      tone(660, 0, 0.12);
      tone(990, 0.1, 0.2);
    } catch (e) {
      console.warn('chime failed', e);
    }
  }

  speak(text: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    const v = this.selectedVoice();
    if (v) u.voice = v;
    window.speechSynthesis.speak(u);
  }

  setVoice(name: string | null): void {
    this.selectedVoiceName.set(name);
    try {
      if (name) localStorage.setItem(VOICE_STORAGE_KEY, name);
      else localStorage.removeItem(VOICE_STORAGE_KEY);
    } catch { /* ignore */ }
  }

  preview(text = 'Hey there — this is your HARSH assistant.'): void {
    this.speak(text);
  }

  private readStoredVoice(): string | null {
    try { return localStorage.getItem(VOICE_STORAGE_KEY); } catch { return null; }
  }

  private detectSupport(): boolean {
    return typeof window !== 'undefined' && (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);
  }
}
