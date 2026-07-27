export interface Scenario {
  id: string;
  name: string;
  description?: string;
  // Keep types loose to avoid cross-layer imports in mock code
  teams: unknown[];
  requests: unknown[];
  metadata?: Record<string, unknown>;
}
