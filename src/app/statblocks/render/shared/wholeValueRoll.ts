import { createContext } from 'react';

/**
 * True inside a value that is one roll as a whole (a check link on its leading number): the text in
 * it links no dice of its own, since a link inside a link would roll something else.
 */
export const WholeValueRollContext = createContext(false);
