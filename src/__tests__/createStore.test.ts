/**
 * Unit tests for the vanilla store primitives. Covers the imperative surface
 * (getState/setState/subscribe) and React hook caching behavior via
 * react-test-renderer (we skip @testing-library because its react-test-renderer
 * pin diverges from what's installed).
 */
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import { createStore } from "../store/createStore";

type Counter = {
  count: number;
  label: string;
  increment: () => void;
};

const makeCounter = () =>
  createStore<Counter>((set) => ({
    count: 0,
    label: "init",
    increment: () => set((s) => ({ count: s.count + 1 })),
  }));

describe("createStore", () => {
  it("exposes the creator's initial state via getState", () => {
    const store = makeCounter();
    expect(store.getState().count).toBe(0);
    expect(store.getState().label).toBe("init");
  });

  it("merges partial updates into state", () => {
    const store = makeCounter();
    store.setState({ label: "updated" });
    expect(store.getState().label).toBe("updated");
    expect(store.getState().count).toBe(0);
  });

  it("supports updater functions receiving current state", () => {
    const store = makeCounter();
    store.setState((s) => ({ count: s.count + 5 }));
    expect(store.getState().count).toBe(5);
  });

  it("invokes actions defined by the creator", () => {
    const store = makeCounter();
    store.getState().increment();
    store.getState().increment();
    expect(store.getState().count).toBe(2);
  });

  it("notifies subscribers after each setState", () => {
    const store = makeCounter();
    const listener = jest.fn();
    store.subscribe(listener);
    store.setState({ count: 1 });
    store.setState({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns an unsubscribe function that stops further notifications", () => {
    const store = makeCounter();
    const listener = jest.fn();
    const off = store.subscribe(listener);
    store.setState({ count: 1 });
    off();
    store.setState({ count: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("delivers each notification to every subscriber", () => {
    const store = makeCounter();
    const a = jest.fn();
    const b = jest.fn();
    store.subscribe(a);
    store.subscribe(b);
    store.setState({ count: 7 });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("ignores null/undefined updater results", () => {
    const store = makeCounter();
    const listener = jest.fn();
    store.subscribe(listener);
    store.setState(null as any);
    store.setState(undefined as any);
    store.setState(() => null as any);
    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify when all keys in the partial match current state", () => {
    const store = makeCounter();
    store.setState({ count: 5, label: "x" });
    const listener = jest.fn();
    store.subscribe(listener);
    store.setState({ count: 5 });
    store.setState({ count: 5, label: "x" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies when at least one key in the partial changes", () => {
    const store = makeCounter();
    store.setState({ count: 5, label: "x" });
    const listener = jest.fn();
    store.subscribe(listener);
    store.setState({ count: 5, label: "y" });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("preserves untouched keys when merging", () => {
    const store = makeCounter();
    store.setState({ count: 99 });
    expect(store.getState().label).toBe("init");
    expect(store.getState().increment).toBeDefined();
  });

  it("supports a single batched setState updating multiple keys at once", () => {
    const store = makeCounter();
    const listener = jest.fn();
    store.subscribe(listener);
    store.setState({ count: 10, label: "batched" });
    expect(store.getState().count).toBe(10);
    expect(store.getState().label).toBe("batched");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("hook returns the whole state by default and re-renders on change", () => {
    const store = makeCounter();
    const snapshots: number[] = [];
    const Probe = () => {
      const s = store();
      snapshots.push(s.count);
      return null;
    };
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    act(() => {
      store.setState({ count: 1 });
    });
    act(() => {
      store.setState({ count: 2 });
    });
    expect(snapshots).toEqual([0, 1, 2]);
    act(() => {
      renderer!.unmount();
    });
  });

  it("selector returning a new object reference does not loop and stays stable per state", () => {
    const store = makeCounter();
    const renders: { count: number }[] = [];
    const Probe = () => {
      // Selector intentionally returns a fresh object every call — pre-fix this
      // would trip React's `getSnapshot should be cached` warning and re-render
      // forever. The cache keyed on state identity is what makes this safe.
      const slice = store((s) => ({ count: s.count }));
      renders.push(slice);
      return null;
    };
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(createElement(Probe));
    });
    // No state change yet → exactly one initial render snapshot.
    expect(renders.length).toBe(1);

    act(() => {
      store.setState({ count: 0 });
    });
    // No-op setState (count was already 0) → no re-render.
    expect(renders.length).toBe(1);

    act(() => {
      store.setState({ count: 5 });
    });
    expect(renders.length).toBe(2);
    expect(renders[1].count).toBe(5);

    act(() => {
      renderer!.unmount();
    });
  });

  it("safely handles a listener that unsubscribes a sibling mid-notification", () => {
    const store = makeCounter();
    const callOrder: string[] = [];
    const listenerA = jest.fn(() => {
      callOrder.push("A");
      offB();
    });
    const listenerB = jest.fn(() => callOrder.push("B"));
    const listenerC = jest.fn(() => callOrder.push("C"));
    store.subscribe(listenerA);
    const offB = store.subscribe(listenerB);
    store.subscribe(listenerC);

    store.setState({ count: 1 });

    // A runs first; even though A removes B mid-iteration, the snapshot
    // means B and C still get notified this round.
    expect(callOrder).toEqual(["A", "B", "C"]);

    store.setState({ count: 2 });
    // Next round: B is detached, only A and C fire.
    expect(callOrder).toEqual(["A", "B", "C", "A", "C"]);
  });
});
