import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  FamilyService,
  ProfileRow,
  ProfileService,
} from 'data-access';

// Profile CRUD — see FEATURES.md §7.3.
// Polymorphic assignee: routines, events, list items can target a profile or a member.

interface ProfileDraft {
  id: string | null;
  name: string;
  kind: ProfileRow['kind'];
  color: string;
}

const DEFAULT_COLORS = [
  '#c98a8a', '#d9a85a', '#4f7a9a', '#7a9a4f', '#9a7ac0',
  '#b1432a', '#d89220', '#c4452a', '#9ca665', '#6b8e9e',
];

const EMPTY_DRAFT: ProfileDraft = { id: null, name: '', kind: 'child', color: DEFAULT_COLORS[0] };

@Component({
  selector: 'harsh-profiles',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profiles.component.html',
  styleUrl: './profiles.component.scss',
})
export class ProfilesComponent implements OnInit, OnDestroy {
  protected readonly profiles = inject(ProfileService);
  private readonly family = inject(FamilyService);
  private readonly router = inject(Router);

  readonly editing = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly loadError = signal<string | null>(null);

  readonly colors = DEFAULT_COLORS;
  draft: ProfileDraft = { ...EMPTY_DRAFT };

  async ngOnInit() {
    try {
      const fam = this.family.family() ?? (await this.family.loadCurrent());
      if (!fam) { await this.router.navigateByUrl('/setup'); return; }
      await this.profiles.load(fam.id);
    } catch (e: any) {
      this.loadError.set(e?.message ?? 'Could not load profiles');
    }
  }

  ngOnDestroy() { this.profiles.unsubscribe(); }

  startAdd() {
    this.draft = { ...EMPTY_DRAFT, color: this.colors[Math.floor(Math.random() * this.colors.length)] };
    this.editing.set(true);
    this.error.set(null);
  }

  startEdit(p: ProfileRow) {
    this.draft = { id: p.id, name: p.name, kind: p.kind, color: p.color };
    this.editing.set(true);
    this.error.set(null);
  }

  cancel() {
    this.editing.set(false);
    this.error.set(null);
  }

  async save() {
    const fam = this.family.family();
    if (!fam) return;
    if (!this.draft.name.trim()) {
      this.error.set('Name is required');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      if (this.draft.id) {
        await this.profiles.update(this.draft.id, {
          name: this.draft.name.trim(),
          kind: this.draft.kind,
          color: this.draft.color,
        });
      } else {
        await this.profiles.create({
          family_id: fam.id,
          name: this.draft.name.trim(),
          kind: this.draft.kind,
          color: this.draft.color,
        });
      }
      this.editing.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Save failed');
    } finally {
      this.busy.set(false);
    }
  }

  async remove(id: string) {
    if (!confirm('Delete this profile? Anything assigned to them stays but becomes unassigned.')) return;
    this.busy.set(true);
    try {
      await this.profiles.remove(id);
      this.editing.set(false);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Delete failed');
    } finally {
      this.busy.set(false);
    }
  }
}
