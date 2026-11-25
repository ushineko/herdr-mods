// A panel's follow lock belongs to the space it was set in (issue #8): the dock's nav
// and git are one copy for the whole window, so each keeps a lock per space. A space
// with no lock follows the focused terminal. Pure: no herdr imports; a lock is whatever
// the panel needs to show it again.

export class SpaceLocks {
  constructor(space = null) {
    this.space = space;
    this.locks = new Map();
  }

  /**
   * Moves to `space`, keeping `held` (the lock in force, or null when following) for
   * the space being left. Returns the new space's lock, null to follow, or undefined
   * when the space did not change.
   */
  enter(space, held) {
    if (space === this.space) return undefined;
    this.set(this.space, held);
    this.space = space;
    return this.locks.get(space) ?? null;
  }

  /** Sets another space's lock (null: it follows). The shown space's is the panel's own. */
  set(space, lock) {
    if (lock) this.locks.set(space, lock);
    else this.locks.delete(space);
  }
}
