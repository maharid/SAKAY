/**
 * SAKAY Booking Utilities
 */

/**
 * Formats a long UUID or booking identifier into a compact, deterministic user-facing string.
 * Example: 'b8a4f3e2-1234-5678-90ab-cdef12345678' -> 'SAKAY-B8A4F3'
 */
export function formatShortBookingId(id?: string): string {
  if (!id) return 'SAKAY-000000';
  if (id.startsWith('SAKAY-') && id.length <= 14) return id;
  const clean = id.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean.length > 6) {
    return `SAKAY-${clean.slice(0, 6)}`;
  }
  return `SAKAY-${clean}`;
}
