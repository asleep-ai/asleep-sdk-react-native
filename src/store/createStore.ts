/**
 * Minimal state container that mirrors the slice of zustand's API this library
 * actually uses: getState, setState (partial or updater fn), subscribe, and a
 * hook that exposes state via React's useSyncExternalStore.
 *
 * Kept as an internal implementation detail so we can drop the external
 * zustand peer dependency.
 */
import { useRef, useSyncExternalStore } from "react";

export type StateUpdater<T> = Partial<T> | ((state: T) => Partial<T>);

export type StoreApi<T> = {
  getState: () => T;
  setState: (updater: StateUpdater<T>) => void;
  subscribe: (listener: () => void) => () => void;
};

export type Selector<T, S> = (state: T) => S;

export type UseBoundStore<T> = {
  (): T;
  <S>(selector: Selector<T, S>): S;
} & StoreApi<T>;

export type StateCreator<T> = (set: StoreApi<T>["setState"], get: StoreApi<T>["getState"]) => T;

export const createStore = <T extends object>(creator: StateCreator<T>): UseBoundStore<T> => {
  const listeners = new Set<() => void>();
  let state: T;

  const setState: StoreApi<T>["setState"] = (updater) => {
    const partial = typeof updater === "function" ? updater(state) : updater;
    if (partial === null || partial === undefined) return;
    let changed = false;
    for (const key in partial) {
      if (!Object.is((partial as T)[key], state[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    state = Object.assign({}, state, partial) as T;
    // Snapshot listeners before iterating: a listener may subscribe or
    // unsubscribe during notification, which would otherwise skip/repeat
    // entries per Set.prototype.forEach semantics.
    [...listeners].forEach((listener) => listener());
  };

  const getState: StoreApi<T>["getState"] = () => state;

  const subscribe: StoreApi<T>["subscribe"] = (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  state = creator(setState, getState);

  const useBoundStore = (<S>(selector?: Selector<T, S>) => {
    // Cache the selector result keyed on the underlying state reference. When
    // a selector returns a fresh object on every call (e.g. `s => ({ x: s.x })`),
    // useSyncExternalStore would otherwise see a new snapshot every read and
    // loop forever — the React 18 "getSnapshot should be cached" warning.
    // Tracking state-identity means we recompute only when the store mutates;
    // intermediate reads within a render return the same reference.
    const cache = useRef<{ state: T; value: S } | null>(null);
    const getSnapshot = () => {
      if (!selector) return state as unknown as S;
      if (!cache.current || cache.current.state !== state) {
        cache.current = { state, value: selector(state) };
      }
      return cache.current.value;
    };
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  }) as UseBoundStore<T>;

  useBoundStore.getState = getState;
  useBoundStore.setState = setState;
  useBoundStore.subscribe = subscribe;

  return useBoundStore;
};
