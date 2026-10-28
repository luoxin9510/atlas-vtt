/** The page's localStorage, or null where the browser refuses it (private mode, blocked site data). */
export function browserStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
