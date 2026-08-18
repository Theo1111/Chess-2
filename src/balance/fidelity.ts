/**
 * Analysis-fidelity flags: how faithfully the simulation models each
 * mechanic. Statistics about limited-fidelity content are still reported,
 * but findings built on them are capped at WATCH and every report carries
 * the limitation notes — the reader must never mistake them for
 * full-fidelity evidence.
 *
 * These limitations are the honest cost of the information boundary; the
 * intended future fix for all of them is information-set search (ISMCTS) or
 * comparable hidden-state sampling, where agents reason over states
 * compatible with their observation instead of reading hidden state.
 */

export type Fidelity = 'full' | 'limited-hidden-information' | 'experimental';

export interface FidelityNote {
  readonly id: string;
  readonly fidelity: Fidelity;
  readonly reason: string;
}

/** Machine-readable limitation switches, embedded in every report. */
export const ANALYSIS_LIMITATIONS = {
  /** Recon's castability reads the size of the hidden enemy hand. */
  reconHiddenState: true,
  /** Search retains smoke-obscured board occupancy for legality/check. */
  smokeScreenObservation: true,
} as const;

const NOTES: readonly FidelityNote[] = [
  {
    id: 'reconnaissance',
    fidelity: 'limited-hidden-information',
    reason:
      "Castability depends on the hidden enemy hand, so agents cannot simulate the cast from their observation — it is scored as a stand-pat instead. Recon statistics under-represent informed play.",
  },
  {
    id: 'smoke-screen',
    fidelity: 'limited-hidden-information',
    reason:
      'Search retains obscured board occupancy for legality/check calculation, so agents are not actually blinded by smoke. Smoke Screen statistics overstate how well bots see through it.',
  },
];

const byId = new Map(NOTES.map((note) => [note.id, note]));

/** Fidelity of a piece/card id. Unlisted content is modelled in full. */
export const contentFidelity = (id: string): Fidelity => byId.get(id)?.fidelity ?? 'full';

export const fidelityNote = (id: string): FidelityNote | undefined => byId.get(id);

export const allFidelityNotes = (): readonly FidelityNote[] => NOTES;
