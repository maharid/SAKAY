import type { XlsxLike } from '@sakay/shared';

/** Loads the `xlsx` package only when an Excel export is asked for (it is large), for the shared export toolbar */
export const loadXlsx = async (): Promise<XlsxLike> => (await import('xlsx')) as unknown as XlsxLike;
