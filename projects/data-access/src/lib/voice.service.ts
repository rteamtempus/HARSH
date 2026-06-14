import { Injectable, computed, inject, signal } from '@angular/core';
import { TTS_ADAPTER } from './adapters/tts.adapter';

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
/**
 * How long after the last new word before we consider the command finished.
 * Lower = snappier turn-taking (the assistant replies sooner), at the cost of
 * cutting off people who pause mid-thought. 1.2s is a balance for a household
 * with ADHD speakers — tune here if it feels too eager or too laggy.
 */
const SILENCE_MS = 1200;
/**
 * Once the recognizer emits a FINAL result (its "utterance ended" signal), wait
 * only this long before submitting. After a final we ignore further interim
 * results, so background noise can't hold the floor open indefinitely — the
 * single biggest cause of "it keeps listening but never acts" in a noisy room.
 */
const ENDPOINT_AFTER_FINAL_MS = 900;
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

  // Optional cloud TTS (Google Chirp 3 HD via the `tts` edge function). Present
  // only in apps that provide TTS_ADAPTER (display + portal). When absent, or
  // when no voice id has been set, speak() uses the browser's native synth.
  private readonly tts = inject(TTS_ADAPTER, { optional: true });
  /** Provider voice id the host app supplies (e.g. a Chirp 3 HD id from family settings). */
  readonly ttsVoiceId = signal<string | null>(null);
  /** TEMPORARY: last speak() outcome, surfaced in the display debug panel. */
  readonly lastTtsInfo = signal('');
  /** The cloud-audio element currently playing, tracked so barge-in can stop it. */
  private currentAudio: HTMLAudioElement | null = null;
  /** Web Audio source for cloud TTS playback (more reliable on a hands-free
   *  kiosk than HTMLAudioElement.play(), which the autoplay policy blocks). */
  private currentSource: AudioBufferSourceNode | null = null;
  /** Bumped on every speak()/cancelSpeech() so a synthesis that resolves after a
   *  barge-in can detect it's stale and not play over the new turn. */
  private speakSeq = 0;

  private recognition: SpeechRecognitionLike | null = null;
  private wakeWantsRun = false;
  private wakeCallback: ((command: string) => void) | null = null;
  private restartGuard = false;
  private audioCtx: AudioContext | null = null;

  // Wake / command state
  private mode: WakeMode = 'idle';
  private commandText = '';
  /** True once the recognizer has finalized at least one segment of this command.
   *  After that we endpoint on finals only and stop letting interim noise re-arm
   *  the timer. */
  private sawFinal = false;
  private silenceHandle: ReturnType<typeof setTimeout> | null = null;
  private maxHandle: ReturnType<typeof setTimeout> | null = null;
  private lastFinalLen = 0;

  // Screen Wake Lock — keeps the phone awake while the mic is live so the
  // screen doesn't sleep mid-sentence. Auto-released by the browser when the
  // tab hides, so we re-acquire on visibilitychange if we're still listening.
  private wakeLock: WakeLockSentinel | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const refresh = () => this.voices.set(window.speechSynthesis.getVoices());
      refresh();
      window.speechSynthesis.onvoiceschanged = refresh;
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.syncWakeLock();
      });
    }
  }

  /** Acquire the screen wake lock when listening, release it when idle. Safe to over-call. */
  private async syncWakeLock(): Promise<void> {
    const wantLock = this.listening() || this.capturingCommand();
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return; // Unsupported (older Safari) — fail soft.
    try {
      if (wantLock && !this.wakeLock) {
        this.wakeLock = await nav.wakeLock.request('screen');
        this.wakeLock.addEventListener?.('release', () => { this.wakeLock = null; });
      } else if (!wantLock && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      // Wake lock can reject (e.g. low battery, not user-activated). Non-fatal.
      this.wakeLock = null;
    }
  }

  /** Push-to-talk one-shot. */
  start(): Promise<string> {
    if (!this.supported()) return Promise.reject(new Error('Speech recognition not supported'));
    if (this.listening()) return Promise.reject(new Error('Already listening'));
    // Barge-in: if the assistant is mid-sentence, stop it so the user has the floor.
    this.cancelSpeech();
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
        void this.syncWakeLock();
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
      void this.syncWakeLock();
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
    void this.syncWakeLock();
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
          this.sawFinal = false;
          // Barge-in: silence any reply still playing so we don't talk over the user.
          this.cancelSpeech();
          this.capturingCommand.set(true);
          void this.syncWakeLock();
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
        if (rest.length !== this.commandText.length) {
          this.commandText = rest;
          this.transcript.set(rest);
        }
        if (anyFinal) {
          // The recognizer marked an utterance boundary — a strong "the speaker
          // finished" signal. Endpoint quickly. Subsequent finals re-arm (the
          // user kept talking); interim-only noise no longer does (see below).
          this.sawFinal = true;
          this.armSilence(r, ENDPOINT_AFTER_FINAL_MS);
        } else if (!this.sawFinal) {
          // Before any final, interim activity means the speaker is mid-command,
          // so keep the window open. Once we've seen a final we deliberately stop
          // re-arming on interim, so background noise can't hold the floor open.
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

  private armSilence(r: SpeechRecognitionLike, delay: number = SILENCE_MS): void {
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
    }, delay);
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

  /** Choose the cloud (Chirp) voice. Pass null to fall back to the browser synth. */
  setTtsVoice(voiceId: string | null): void {
    this.ttsVoiceId.set(voiceId);
  }

  /**
   * Speak `text`. Prefers cloud TTS (Chirp 3 HD) when an adapter and a voice id
   * are configured; falls back to the browser's native synth on any failure
   * (no API key on the edge function, network error, unsupported). Always
   * cancels whatever is currently playing first so replies don't overlap.
   */
  async speak(text: string): Promise<void> {
    if (typeof window === 'undefined' || !text) return;
    this.cancelSpeech();
    const seq = ++this.speakSeq;
    const voiceId = this.ttsVoiceId();
    this.lastTtsInfo.set(`try tts=${!!this.tts} voiceId=${voiceId ?? 'none'}`);
    if (this.tts && voiceId) {
      try {
        const res = await this.tts.synthesize(text, { voiceId });
        // If a barge-in (or another reply) happened while we awaited synthesis,
        // this audio is stale — drop it rather than play over the new turn.
        if (seq !== this.speakSeq) return;
        await this.playViaWebAudio(res.audio, seq);
        this.lastTtsInfo.set('chirp: playing (webaudio)');
        return;
      } catch (e: any) {
        this.lastTtsInfo.set(`chirp FAILED (${e?.message ?? e}) → browser`);
        console.warn('Chirp TTS failed; falling back to browser synth', e);
        // fall through to the native synth below
      }
    }
    this.speakBrowser(text);
  }

  /**
   * Play encoded audio (Chirp returns MP3) through the shared AudioContext.
   * Once that context is unlocked by a user gesture (the "Enable Hey HARSH"
   * tap → unlockAudio()), Web Audio plays without the per-utterance gesture the
   * autoplay policy demands of HTMLAudioElement.play() — the right primitive for
   * a hands-free display.
   */
  private async playViaWebAudio(audio: ArrayBuffer, seq: number): Promise<void> {
    this.unlockAudio();
    const ctx = this.audioCtx;
    if (!ctx) throw new Error('no AudioContext');
    if (ctx.state === 'suspended') await ctx.resume();
    // decodeAudioData detaches its input buffer, so hand it a copy.
    const decoded = await ctx.decodeAudioData(audio.slice(0));
    if (seq !== this.speakSeq) return; // barge-in landed during decode
    const src = ctx.createBufferSource();
    src.buffer = decoded;
    src.connect(ctx.destination);
    src.onended = () => { if (this.currentSource === src) this.currentSource = null; };
    this.currentSource = src;
    src.start();
  }

  /** Create + resume the AudioContext. Call from a user gesture (button tap) so
   *  the browser actually unlocks audio output for later voice-triggered speech. */
  unlockAudio(): void {
    if (typeof window === 'undefined') return;
    try {
      if (!this.audioCtx) this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
    } catch { /* ignore */ }
  }

  private speakBrowser(text: string): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text) {
      this.lastTtsInfo.update((s) => `${s} | no speechSynthesis`);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    const v = this.selectedVoice();
    if (v) u.voice = v;
    try {
      window.speechSynthesis.speak(u);
      this.lastTtsInfo.update((s) => `${s} | browser.speak (voices=${this.voices().length})`);
    } catch (e: any) {
      this.lastTtsInfo.update((s) => `${s} | browser FAILED ${e?.message ?? e}`);
    }
  }

  /**
   * Stop any in-progress speech immediately — both cloud audio and the native
   * synth. Called on barge-in (the user starts a new command while the
   * assistant is still talking) so the assistant yields the floor.
   */
  cancelSpeech(): void {
    this.speakSeq++;
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch { /* noop */ }
      this.currentSource = null;
    }
    if (this.currentAudio) {
      try { this.currentAudio.pause(); } catch { /* noop */ }
      this.currentAudio = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    }
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
