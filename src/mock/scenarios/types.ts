export interface Scenario {
  id: string;
  name: string;
  description?: string;
  // Keep types loose to avoid cross-layer imports in mock code
  teams: any[];
  requests: any[];
  metadata?: Record<string, unknown>;
}
