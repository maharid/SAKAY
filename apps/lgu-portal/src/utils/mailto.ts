// Helpers for the Settings > Help & Support panel. The portal has no server route that receives feedback, so feedback leaves the page as an e-mail
// the person reviews and sends from their own e-mail program.

export function mailtoLink(to: string, subject: string, body: string): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Hands the link to the e-mail program (the page itself stays where it is). */
export function openMailDraft(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Copies text to the clipboard. False when the browser does not allow it (an insecure address, a blocked permission). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
