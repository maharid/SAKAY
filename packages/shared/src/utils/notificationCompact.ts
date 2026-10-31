/**
 * A notice in the bell panel is read at a glance, so its text is short: what to do, for whom, by when. The full wording stays in the database and on the page the notice opens.
 * Known notices get one tidy sentence ("Renew DWCC TODA's Barangay Clearance by Dec 31, 2026 to keep drivers online."); any other notice keeps its first sentences, loses the
 * "Open ... for the details" instructions (the row itself opens the page) and is cut at a sentence or a word, never in the middle of a date or a name.
 */

const DATE = String.raw`[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}`;
const EXPIRING = new RegExp(String.raw`^(.+?) \(certificate [^)]*\) is valid until (${DATE})\.`);
const EXPIRED = new RegExp(String.raw`^(.+?) \(certificate [^)]*\) expired on (${DATE})\.`);
const EXPIRED_LGU = new RegExp(String.raw`^The accreditation of (.+?) expired on (${DATE})\.`);
const NAVIGATION_SENTENCE = /^(open|go to|tap|click|press|visit|check)\b/i;

const MAX_LENGTH = 120;

function sentencesOf(text: string): string[] {
  // a sentence ends at . ! or ? followed by a space; "Dec 31, 2026." keeps its comma, and an abbreviation like "No." is rare enough in these notices
  return text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const space = slice.lastIndexOf(' ');
  return `${(space > max * 0.6 ? slice.slice(0, space) : slice).replace(/[\s,;:-]+$/, '')}…`;
}

/** The notice's message, short. `type` is the notification type the database wrote (it picks the tidy wording of the known notices). */
export function compactNotificationMessage(message: string | null | undefined, type?: string | null): string {
  const text = (message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const kind = (type ?? '').toUpperCase();

  if (kind === 'TODA_ACCREDITATION_EXPIRING') {
    const m = text.match(EXPIRING);
    if (m) return `Renew ${m[1]}'s Barangay Clearance by ${m[2]} to keep drivers online.`;
  }
  if (kind === 'TODA_ACCREDITATION_EXPIRED') {
    const m = text.match(EXPIRED);
    if (m) return `${m[1]}'s accreditation expired on ${m[2]}. Drivers cannot go online until it is renewed.`;
  }
  if (kind === 'TODA_ACCREDITATION_EXPIRED_LGU') {
    const m = text.match(EXPIRED_LGU);
    if (m) return `${m[1]}'s accreditation expired on ${m[2]}. Its drivers cannot go online.`;
  }

  const kept = sentencesOf(text).filter((s, i) => i === 0 || !NAVIGATION_SENTENCE.test(s));
  if (kept.length === 0) return cutAtWord(text, MAX_LENGTH);
  let out = kept[0];
  // a second sentence only when it is short enough to read at a glance with the first
  if (kept[1] && `${out} ${kept[1]}`.length <= MAX_LENGTH) out = `${out} ${kept[1]}`;
  return cutAtWord(out, MAX_LENGTH);
}
