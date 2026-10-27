type SeatStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface StoredSeat {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface SeatStore {
  read(code: string): StoredSeat | null;
  write(code: string, seat: StoredSeat): void;
  forget(code: string): void;
  ownCode(code: string): string | null;
  writeOwnCode(code: string, own: string): void;
}

const seatKey = (code: string): string => `atlas-play:seat:${code}`;
const ownCodeKey = (code: string): string => `atlas-play:own-code:${code}`;

function attempt<T>(fallback: T, action: () => T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

/** The player's seat per table, in the browser's storage; storage that is missing, full or holds junk reads as no seat. */
export function seatStore(storage: SeatStorage | null): SeatStore {
  return {
    read(code) {
      if (storage === null) return null;
      return attempt(null, () => {
        const raw = storage.getItem(seatKey(code));
        if (raw === null) return null;
        const value: unknown = JSON.parse(raw);
        if (typeof value !== 'object' || value === null) return null;
        const { id, key, name } = value as Record<string, unknown>;
        return typeof id === 'string' && typeof key === 'string' && typeof name === 'string' ? { id, key, name } : null;
      });
    },
    write(code, seat) {
      attempt(undefined, () => storage?.setItem(seatKey(code), JSON.stringify({ id: seat.id, key: seat.key, name: seat.name })));
    },
    forget(code) {
      attempt(undefined, () => storage?.removeItem(seatKey(code)));
    },
    ownCode(code) {
      return attempt(null, () => storage?.getItem(ownCodeKey(code)) ?? null);
    },
    writeOwnCode(code, own) {
      attempt(undefined, () => storage?.setItem(ownCodeKey(code), own));
    },
  };
}
