/** A Philippine mobile number the way a person reads it: "+63 917 123 4567". Anything that is not a recognisable mobile number is shown as it was written. */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  const original = String(raw ?? '').trim();
  const digits = original.replace(/\D/g, '');
  const national = digits.startsWith('63') && digits.length === 12 ? digits.slice(2) : digits.startsWith('09') && digits.length === 11 ? digits.slice(1) : digits.length === 10 && digits.startsWith('9') ? digits : null;
  if (!national) return original;
  return `+63 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

/** The number for tel: and sms: links (digits and a leading +), or null when there is nothing to dial */
export function phoneHref(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length < 7) return null;
  const national = digits.startsWith('63') && digits.length === 12 ? digits.slice(2) : digits.startsWith('09') && digits.length === 11 ? digits.slice(1) : digits.length === 10 && digits.startsWith('9') ? digits : null;
  return national ? `+63${national}` : text.startsWith('+') ? `+${digits}` : digits;
}
