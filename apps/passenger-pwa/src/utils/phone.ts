// Phone number formatting utility for E.164 compliance

export const formatPhoneToE164 = (phone: string): string => {
  // Remove all non-numeric characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 63, prepend '+'
  if (cleaned.startsWith('63')) {
    return `+${cleaned}`;
  }
  
  // If it starts with 0 (e.g. 0917...), replace 0 with +63
  if (cleaned.startsWith('0')) {
    return `+63${cleaned.slice(1)}`;
  }
  
  // If it starts with 9 (e.g. 917...), prepend +63
  if (cleaned.length === 10 && cleaned.startsWith('9')) {
    return `+63${cleaned}`;
  }
  
  // Fallback
  return `+${cleaned}`;
};
