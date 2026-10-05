export const scrollToFirstError = (root?: HTMLElement | Document | null) => {
  setTimeout(() => {
    const doc = root || document;
    const errorEl = doc.querySelector(
      '[data-error="true"], .Mui-error, .anim-shake, [aria-invalid="true"]'
    );
    if (errorEl) {
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const inputEl = errorEl.querySelector('input, textarea, select') as HTMLElement;
      if (inputEl) {
        inputEl.focus({ preventScroll: true });
      }
    }
  }, 60);
};
