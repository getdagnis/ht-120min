import type { ManagerSpotlight } from '../../utils/manager-spotlight.js';

// React subscribes to this state; keeping request ownership here lets already
// loaded profiles remain navigable while a single background request runs.
export class SpotlightBrowser {
  private listeners = new Set<() => void>();
  private visited: Set<number>;
  private complete = false;
  private state: {
    spotlight: ManagerSpotlight | null;
    available: ManagerSpotlight[];
    loading: boolean;
    failed: boolean;
    hasMore: boolean;
  };

  constructor(initial: ManagerSpotlight | null, profiles: ManagerSpotlight[],
    private loadRemaining?: () => Promise<ManagerSpotlight[]>, hasMore = profiles.length > 1) {
    this.visited = new Set(initial ? [initial.managerId] : []);
    this.state = { spotlight: initial, available: this.unique(initial ? [initial, ...profiles] : profiles), loading: false, failed: false, hasMore };
  }
  private unique(profiles: ManagerSpotlight[]) {
    return [...new Map(profiles.map(profile => [profile.managerId, profile])).values()];
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }
  next = () => {
    const { available, spotlight } = this.state;
    const unvisited = available.filter(profile => !this.visited.has(profile.managerId));
    const pool = unvisited.length ? unvisited : available.filter(profile => profile.managerId !== spotlight?.managerId);
    if (!pool.length) {
      if (this.state.hasMore) void this.retry();
      return;
    }
    const next = pool[Math.floor(Math.random() * pool.length)]!;
    this.visited = unvisited.length ? new Set([...this.visited, next.managerId]) : new Set([next.managerId]);
    // Publish the prefetched selection before starting or awaiting the request.
    this.update({ spotlight: next });
    void this.retry();
  };
  retry = async () => {
    if (!this.loadRemaining || this.state.loading || this.complete) return;
    this.update({ loading: true, failed: false });
    try {
      const profiles = await this.loadRemaining();
      this.complete = true;
      this.update({ available: this.unique([...this.state.available, ...profiles]), loading: false, hasMore: false });
    } catch {
      this.update({ loading: false, failed: true });
    }
  };
}
