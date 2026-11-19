import { createContext, useContext } from 'react';

export const InteractionContext = createContext<() => boolean>(() => true);
export const useInteraction = () => useContext(InteractionContext);
