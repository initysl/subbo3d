import type { SimEvent, SimEventKind } from "./types";

/**
 * A fixed-capacity, pre-allocated event buffer.
 *
 * Events are emitted from the innermost part of the solver, so allocating here
 * would put garbage collection directly in the frame path. Every slot is
 * created once at construction and then overwritten in place forever.
 */
export class SimEventBuffer {
  readonly capacity: number;
  count = 0;
  /** Number of events dropped because the buffer was full, for diagnostics. */
  overflow = 0;

  private readonly items: SimEvent[];

  constructor(capacity = 256) {
    this.capacity = capacity;
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this.items[i] = { kind: 0 as SimEventKind, a: -1, b: -1, impulse: 0, x: 0, y: 0, z: 0, meta: 0 };
    }
  }

  clear(): void {
    this.count = 0;
    this.overflow = 0;
  }

  emit(
    kind: SimEventKind,
    a: number,
    b: number,
    impulse: number,
    x: number,
    y: number,
    z: number,
    meta = 0,
  ): void {
    if (this.count >= this.capacity) {
      this.overflow++;
      return;
    }
    const e = this.items[this.count++];
    e.kind = kind;
    e.a = a;
    e.b = b;
    e.impulse = impulse;
    e.x = x;
    e.y = y;
    e.z = z;
    e.meta = meta;
  }

  /** Read an event by index. The returned object is reused — do not retain it. */
  at(i: number): SimEvent {
    return this.items[i];
  }
}
