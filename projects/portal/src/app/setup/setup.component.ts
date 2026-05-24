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
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.scss',
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
