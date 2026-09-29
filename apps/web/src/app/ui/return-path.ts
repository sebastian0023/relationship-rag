/**
 * Screens opened from another section (a chat citation, a letter, a card) carry the path to return
 * to in `?from=`. Only in-app paths are accepted.
 */
export const safeReturnPath = (value: string | null | undefined): string | null =>
  typeof value === 'string' && value.startsWith('/app/') && !value.includes('//') ? value : null;

/** Label for the back button, named after the section the path belongs to. */
export const returnLabel = (path: string | null): string => {
  if (path?.startsWith('/app/chat')) return 'Conversar';
  if (path?.startsWith('/app/inbox')) return 'Buzón';
  if (path?.startsWith('/app/cards')) return 'Tarjetas';
  return 'Recuerdos';
};
