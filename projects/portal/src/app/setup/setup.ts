import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { FamilyService, MemberSeed, detectTz } from 'data-access';

const DEFAULT_HARSH_MEMBERS: MemberSeed[] = [
  { display_name: 'Holly', color: '#c98a8a' },
  { display_name: 'Ayla', color: '#d9a85a' },
  { display_name: 'Rory', color: '#4f7a9a' },
  { display_name: 'Stevie', color: '#7a9a4f' },
  { display_name: 'Hazel', color: '#9a7ac0' },
];

@Component({
  selector: 'harsh-setup',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="wrap">
      <h1>Set up your family</h1>
      <p>Name your household and add the people in it. You can edit this later.</p>

      <form (submit)="$event.preventDefault(); save()">
        <label>
          Household name
          <input type="text" [(ngModel)]="name" name="name" required />
        </label>

        <p class="hint">Which name above is you? (we'll mark you as the owner)</p>
        <label>
          Your name
          <input type="text" [(ngModel)]="ownerName" name="ownerName" required />
        </label>

        <h2>Members</h2>
        <ul class="members">
          @for (m of members(); track $index; let i = $index) {
            <li>
              <span class="dot" [style.background]="m.color"></span>
              <input
                type="text"
                [ngModel]="m.display_name"
                (ngModelChange)="updateMember(i, 'display_name', $event)"
                [name]="'mname-' + i"
              />
              <input
                type="color"
                [ngModel]="m.color"
                (ngModelChange)="updateMember(i, 'color', $event)"
                [name]="'mcolor-' + i"
              />
              <button type="button" class="remove" (click)="removeMember(i)" aria-label="Remove">×</button>
            </li>
          }
        </ul>
        <button type="button" class="add" (click)="addMember()">+ Add member</button>

        <button type="submit" [disabled]="busy()" class="primary">
          {{ busy() ? 'Saving…' : 'Create family' }}
        </button>
        @if (error(); as e) { <p class="error">{{ e }}</p> }
      </form>
    </main>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:var(--bg-canvas); color:var(--text-primary); }
    .wrap { max-width:32rem; margin:0 auto; padding:var(--s-6) var(--s-5) var(--s-8); }
    h1 { margin:0 0 var(--s-2); font-family:var(--font-display); }
    h2 { margin:var(--s-5) 0 var(--s-2); font-size:var(--fs-small); color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.08em; font-family:var(--font-sans); font-weight:600; }
    form { display:flex; flex-direction:column; gap:var(--s-4); }
    label { display:flex; flex-direction:column; gap:var(--s-1); font-weight:500; color:var(--text-secondary); font-size:var(--fs-small); }
    input[type=text] { padding:var(--s-3) var(--s-4); font-size:var(--fs-body); border-radius:var(--r-md); border:1px solid var(--line-default); background:var(--bg-sunken); color:var(--text-primary); }
    input[type=text]:focus { outline:2px solid var(--accent); outline-offset:1px; border-color:transparent; }
    .hint { color:var(--text-tertiary); margin:0; font-size:var(--fs-small); }
    .members { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:var(--s-2); }
    .members li { display:flex; align-items:center; gap:var(--s-3); background:var(--bg-raised); padding:var(--s-2) var(--s-3); border-radius:var(--r-md); border:1px solid var(--line-subtle); box-shadow:var(--shadow-sm); }
    .members li input[type=text] { flex:1; padding:var(--s-2) var(--s-3); }
    .dot { width:1.1rem; height:1.1rem; border-radius:var(--r-pill); flex:none; box-shadow:0 0 0 2px var(--bg-raised), 0 0 0 3px var(--line-default); }
    .remove { background:transparent; border:0; color:var(--text-tertiary); font-size:var(--fs-h2); cursor:pointer; padding:0 var(--s-2); line-height:1; }
    .remove:hover { color:var(--danger); }
    .add { align-self:flex-start; background:transparent; color:var(--accent); border:1px dashed var(--accent); padding:var(--s-2) var(--s-3); border-radius:var(--r-md); cursor:pointer; font-size:var(--fs-small); }
    .add:hover { background:var(--accent-soft); }
    .primary { margin-top:var(--s-4); padding:var(--s-3) var(--s-4); font-size:var(--fs-body); border-radius:var(--r-md); border:0; background:var(--accent); color:var(--text-on-accent); font-weight:600; cursor:pointer; transition:background var(--dur-fast) var(--ease-out); }
    .primary:hover:not(:disabled) { background:var(--accent-hover); }
    .primary:disabled { opacity:0.5; }
    .error { color:var(--danger); font-size:var(--fs-small); }
  `],
})
export class SetupComponent {
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  name = 'HARSH';
  ownerName = 'Rory';
  readonly members = signal<MemberSeed[]>(DEFAULT_HARSH_MEMBERS.map((m) => ({ ...m })));
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  addMember(): void {
    this.members.update((arr) => [...arr, { display_name: '', color: '#6b8e9e' }]);
  }
  removeMember(i: number): void {
    this.members.update((arr) => arr.filter((_, idx) => idx !== i));
  }
  updateMember<K extends keyof MemberSeed>(i: number, key: K, value: MemberSeed[K]): void {
    this.members.update((arr) => arr.map((m, idx) => (idx === i ? { ...m, [key]: value } : m)));
  }

  async save(): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      const seeds = this.members().filter((m) => m.display_name.trim().length > 0);
      if (!seeds.some((m) => m.display_name.toLowerCase() === this.ownerName.toLowerCase())) {
        throw new Error(`"${this.ownerName}" must match one of the member names exactly.`);
      }
      await this.family.createFamily(this.name.trim(), seeds, this.ownerName, detectTz());
      await this.router.navigateByUrl('/');
    } catch (e: any) {
      this.error.set(e?.message ?? 'Could not create family');
    } finally {
      this.busy.set(false);
    }
  }
}
