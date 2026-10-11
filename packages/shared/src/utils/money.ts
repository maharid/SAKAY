/**
 * Pesos as the database gives them, with their centavos: 63 -> "₱63.00", 63.4 -> "₱63.40".
 *
 * This only DISPLAYS an amount. It never rounds one: every fare is worked out in the database (public.calculate_fare), which decides
 * what is charged (Rule 6.1.2), so an amount shown here is always an amount that came from there.
 */
export function formatPeso(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  return `₱${amount.toFixed(2)}`;
}
