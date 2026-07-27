import type { Scenario } from './types';
import happyPath from './scenario-happy-path';
import noAvailable from './scenario-no-available';
import falseAvailability from './scenario-false-availability';
import futureAvailability from './scenario-future-availability';
import international from './scenario-international';
import hfi from './scenario-hfi';
import chppFailure from './scenario-chpp-failure';

const ALL_SCENARIOS: Scenario[] = [
  happyPath,
  noAvailable,
  falseAvailability,
  futureAvailability,
  international,
  hfi,
  chppFailure,
];

export function getAllScenarios(): Scenario[] {
  return ALL_SCENARIOS.map((s) => ({ ...s }));
}

export function findScenarioById(id: string): Scenario | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

export default {
  getAllScenarios,
  findScenarioById,
};
