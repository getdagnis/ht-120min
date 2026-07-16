import React, { useState } from 'react';
import { Button } from '../../Button/Button';
import { SectionCard } from '../../Card/SectionCard';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';
import { formatCalendarDate, formatCalendarDateWithWeek, getCupWeekDecoration } from '../../../utils/hattrick-calendar';
import type { ScheduleDraftPreview, ScheduleMode } from '../../../utils/schedule-draft';
import type { RescheduleDraftPreview } from '../../../utils/reschedule-draft';

interface TournamentSchedulePanelProps {
  isGenerated: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  draft: ScheduleDraftPreview;
  onScheduleModeChange: (mode: ScheduleMode) => void;
  onSelectedStartSlotIdChange: (value: string) => void;
  includeWeek15WeekendFriendly: boolean;
  onIncludeWeek15WeekendFriendlyChange: (value: boolean) => void;
  isGenerating: boolean;
  onGenerate: () => void;
  tournamentTeamLimit?: number | null;
  generatedSummary?: {
    scheduleMode?: string | null;
    scheduleStartSlot?: string | null;
    scheduleLockedAt?: string | null;
    registrationClosedAt?: string | null;
    scheduleGeneratedAt?: string | null;
  };
  rescheduleDraft?: RescheduleDraftPreview | null;
  onRescheduleFromRoundChange?: (roundNumber: number) => void;
  onRescheduleStartSlotIdChange?: (value: string) => void;
  includeWeek15WeekendFriendlyForReschedule?: boolean;
  onIncludeWeek15WeekendFriendlyForRescheduleChange?: (value: boolean) => void;
  isRescheduling?: boolean;
  onReschedule?: () => void;
}

function formatModeLabel(mode: ScheduleMode) {
  if (mode === 'single') return 'Play each other once';
  if (mode === 'double') return 'Play each other twice';
  return 'Recurring schedule';
}

function formatModeReason(reason: string | null) {
  return reason || 'No valid start window found yet.';
}

function getPlannerTeamCount(draft: ScheduleDraftPreview, tournamentTeamLimit?: number | null) {
  if (tournamentTeamLimit && tournamentTeamLimit > 0) return tournamentTeamLimit;
  return draft.teamCount % 2 === 0 ? draft.teamCount : draft.teamCount + 1;
}

function formatSeasonWeek(slot: { ht120minSeason: number; htWeek: number }, includeWeekend = false) {
  return `S${slot.ht120minSeason} W${slot.htWeek}${includeWeekend ? ' (weekend)' : ''}`;
}

function formatStartOption(slot: ScheduleDraftPreview['startSlotOptions'][number], options?: { current?: boolean }) {
  const cupDecoration = getCupWeekDecoration(slot.htWeek);
  const current = options?.current ? ' (current)' : '';
  if (!slot.selectable && slot.kind === 'blocked_cup_week') {
    return `Week ${slot.htWeek} / ${formatShortDate(slot.nominalDate)} • ⛔️ ${cupDecoration?.label ?? 'Cup'}${current}`;
  }

  const cupSuffix = cupDecoration ? ` • ${cupDecoration.tone === 'warning' ? '⚠️' : '🟢'} ${cupDecoration.label}` : '';
  const weekend = slot.kind === 'weekend_friendly' ? ' (weekend)' : '';
  return `Week ${slot.htWeek} / ${formatShortDate(slot.nominalDate)}${weekend}${cupSuffix}${current}`;
}

function formatLeadTime(daysUntilStart: number | null) {
  if (daysUntilStart == null) return '? days';
  if (daysUntilStart > 14) return `${Math.floor(daysUntilStart / 7)} weeks from now`;
  return `${daysUntilStart} day${daysUntilStart === 1 ? '' : 's'}`;
}

function getSelectedStartWarning(daysUntilStart: number | null) {
  if (daysUntilStart == null) return null;
  if (daysUntilStart === 3 || daysUntilStart === 4) return `⚠️ In ${daysUntilStart} days`;
  if (daysUntilStart > 14) return `⚠️ In ${formatLeadTime(daysUntilStart)}`;
  return null;
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat('lv-LV', {
    timeZone: 'Europe/Stockholm',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function formatLongDate(date: Date) {
  return formatCalendarDateWithWeek(date, 'long');
}

function formatModeSummary(mode: ScheduleMode) {
  if (mode === 'single') return 'single round-robin';
  if (mode === 'double') return 'double round-robin';
  return 'recurring';
}

export const TournamentSchedulePanel: React.FC<TournamentSchedulePanelProps> = ({
  isGenerated,
  isCollapsed,
  onToggleCollapse,
  draft,
  onScheduleModeChange,
  onSelectedStartSlotIdChange,
  includeWeek15WeekendFriendly,
  onIncludeWeek15WeekendFriendlyChange,
  isGenerating,
  onGenerate,
  tournamentTeamLimit,
  rescheduleDraft,
  onRescheduleFromRoundChange,
  onRescheduleStartSlotIdChange,
  includeWeek15WeekendFriendlyForReschedule = false,
  onIncludeWeek15WeekendFriendlyForRescheduleChange,
  isRescheduling = false,
  onReschedule,
}) => {
  const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
  const plannerTeamCount = getPlannerTeamCount(draft, tournamentTeamLimit);
  const selectedStartWarning =
    draft.requestedStartSlotId && draft.selectedStartSlot && getCupWeekDecoration(draft.selectedStartSlot.htWeek)
      ? null
      : draft.requestedStartSlotId
        ? getSelectedStartWarning(draft.daysUntilStart)
        : null;
  const validStartSlotIds = new Set(draft.startSlotOptions.map((slot) => slot.id));
  const dropdownOptions = draft.allSlotOptions.flatMap((slot, index, slots) => {
    const previous = slots[index - 1];
    const header =
      !previous || previous.ht120minSeason !== slot.ht120minSeason
        ? [
            {
              kind: 'header' as const,
              id: `season-${slot.ht120minSeason} jump`,
              label: ``,
            },
            {
              kind: 'header' as const,
              id: `season-${slot.ht120minSeason}`,
              label: `HT-120min Season ${slot.ht120minSeason}`,
            },
          ]
        : [];
    return [...header, { kind: 'slot' as const, slot }];
  });
  const subtitle = draft.selectedStartSlot
    ? `Closest start date: ${formatCalendarDate(draft.selectedStartSlot.nominalDate)} (${formatLeadTime(draft.daysUntilStart)})`
    : 'No valid start window found';
  const firstRound = draft.rounds[0] || null;
  const lastRound = draft.rounds[draft.rounds.length - 1] || null;
  const rescheduleValidStartSlotIds = new Set(rescheduleDraft?.startSlotOptions.map((slot) => slot.id) ?? []);
  const rescheduleDropdownOptions = (rescheduleDraft?.allSlotOptions ?? []).flatMap((slot, index, slots) => {
    const previous = slots[index - 1];
    const header =
      !previous || previous.ht120minSeason !== slot.ht120minSeason
        ? [
            {
              kind: 'header' as const,
              id: `reschedule-season-${slot.ht120minSeason} jump`,
              label: ``,
            },
            {
              kind: 'header' as const,
              id: `reschedule-season-${slot.ht120minSeason}`,
              label: `HT-120min Season ${slot.ht120minSeason}`,
            },
          ]
        : [];
    return [...header, { kind: 'slot' as const, slot }];
  });
  const rescheduleLastRound = rescheduleDraft?.rounds[rescheduleDraft.rounds.length - 1] || null;
  const hasSelectedRescheduleRound = Boolean(rescheduleDraft?.selectedFromRoundNumber);
  const hasSelectedRescheduleStart = Boolean(rescheduleDraft?.selectedStartSlot);
  const hasSelectedStartSlot = Boolean(draft.requestedStartSlotId);
  const showCalendarPreview = hasSelectedStartSlot && draft.rounds.length > 0;
  const startSlotPlaceholder =
    draft.valid || draft.startSlotOptions.length > 0
      ? 'Select a start date...'
      : draft.reason === 'At least 2 active teams are required.'
        ? 'Not enough teams'
        : draft.reason || 'No valid start date';
  const invalidReason = !draft.valid ? draft.blockingReasons[0] || draft.reason : null;

  return (
    <SectionCard
      title={isGenerated ? 'Manage schedule' : 'Generate a schedule'}
      className={adminStyles.scheduleCard}
      collapsible
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      {!isGenerated ? (
        <div className={adminStyles.genOptions}>
          <div className={adminStyles.scheduleIntro}>
            <h2>{plannerTeamCount} team tournament</h2>
            <p className={adminStyles.scheduleSubtitle}>{subtitle}</p>
          </div>

          <div className={adminStyles.checkboxGroup}>
            {draft.availableModes.map((option) => (
              <label
                key={option.mode}
                className={adminStyles.checkboxLabel}
                aria-disabled={!option.available}
                title={option.available ? undefined : formatModeReason(option.reason)}
              >
                <input
                  type="radio"
                  name="scheduleMode"
                  checked={draft.mode === option.mode}
                  disabled={!option.available}
                  onChange={() => onScheduleModeChange(option.mode)}
                />
                <div className={adminStyles.labelRow}>
                  <span>{formatModeLabel(option.mode)}</span>
                  {!option.available && (
                    <span className={adminStyles.smallNote}>{formatModeReason(option.reason)}</span>
                  )}
                </div>
              </label>
            ))}
          </div>

          <div className={adminStyles.startSlotGroup}>
            <h3 className={adminStyles.startSlotLabel}>Choose start date</h3>
            <select
              className={adminStyles.startSlotSelect}
              value={draft.requestedStartSlotId || ''}
              onChange={(e) => onSelectedStartSlotIdChange(e.target.value)}
              disabled={draft.startSlotOptions.length === 0}
            >
              <option value="" disabled>
                {startSlotPlaceholder}
              </option>
              {dropdownOptions.map((option) =>
                option.kind === 'header' ? (
                  <option key={option.id} value={option.id} disabled>
                    {option.label}
                  </option>
                ) : (
                  <option
                    key={option.slot.id}
                    value={option.slot.id}
                    disabled={!option.slot.selectable || !validStartSlotIds.has(option.slot.id)}
                  >
                    {formatStartOption(option.slot)}
                  </option>
                ),
              )}
            </select>
            {selectedStartWarning && <p className={adminStyles.startSlotWarning}>{selectedStartWarning}</p>}
          </div>

          {draft.canIncludeWeek15WeekendFriendly && (
            <label className={adminStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={includeWeek15WeekendFriendly}
                onChange={(event) => onIncludeWeek15WeekendFriendlyChange(event.target.checked)}
              />
              <span>also include week 15 friendly match (possible qualifiers)</span>
            </label>
          )}

          {showCalendarPreview && (
            <div className={adminStyles.schedulePreview}>
              <h3>Calendar preview</h3>
              {draft.rounds.map((round) => (
                <div key={round.roundNumber} className={adminStyles.previewRow}>
                  <button
                    type="button"
                    className={adminStyles.previewToggle}
                    onClick={() =>
                      setExpandedRounds((current) => ({
                        ...current,
                        [round.roundNumber]: !current[round.roundNumber],
                      }))
                    }
                  >
                    <strong>Round {round.roundNumber}: </strong>
                    <span>
                      {' '}
                      {round.displayDateLabel} • {formatSeasonWeek(round.slot, round.slot.kind === 'weekend_friendly')}
                    </span>
                  </button>
                  {expandedRounds[round.roundNumber] && (
                    <div className={adminStyles.previewMatches}>
                      {round.matches.map((match) => (
                        <div
                          key={`${round.roundNumber}-${match.homeTeamId}-${match.awayTeamId}`}
                          className={adminStyles.roundRow}
                        >
                          {match.isBye ? (
                            <>
                              {match.homeTeamName === 'BYE' ? match.awayTeamName : match.homeTeamName}
                              <span> has a BYE</span>
                            </>
                          ) : (
                            <>
                              {match.homeTeamName}
                              <span className={adminStyles.rowmiddle}> vs</span> {match.awayTeamName}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {invalidReason && <p className={adminStyles.scheduleReason}>{invalidReason}</p>}

          {draft.valid && firstRound && lastRound && hasSelectedStartSlot && (
            <div className={adminStyles.scheduleNotice}>
              <span>
                Generate a schedule for a{' '}
                <strong>
                  {plannerTeamCount} team {formatModeSummary(draft.mode)}
                </strong>{' '}
                tournament that will start on <strong>{formatLongDate(firstRound.displayDate)}</strong> and last for{' '}
                <strong>{draft.roundCount} rounds</strong> with the last round played on{' '}
                <strong>{formatLongDate(lastRound.displayDate)}</strong>.
              </span>
            </div>
          )}

          <div className={adminStyles.scheduleAction}>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={onGenerate}
              disabled={!draft.valid || isGenerating || !hasSelectedStartSlot}
            >
              Generate a schedule
            </Button>
          </div>

          <p className="center w-100">Generating a schedule also closes registration and locks the selected start.</p>
        </div>
      ) : rescheduleDraft ? (
        <div className={adminStyles.genOptions}>
          <div className={adminStyles.scheduleIntro}>
            <h2>Regenerate schedule</h2>
            <p className={adminStyles.scheduleSubtitle}>Move future unarranged rounds without changing pairings.</p>
          </div>

          <div className={adminStyles.startSlotGroup}>
            <label className={adminStyles.startSlotLabel}>Regenerate from round</label>
            <select
              className={adminStyles.startSlotSelect}
              value={rescheduleDraft.selectedFromRoundNumber || ''}
              onChange={(event) => onRescheduleFromRoundChange?.(Number(event.target.value))}
              disabled={
                !onRescheduleFromRoundChange || rescheduleDraft.roundChoices.every((choice) => !choice.available)
              }
            >
              <option value="">Select...</option>
              {rescheduleDraft.roundChoices.map((choice) => (
                <option key={choice.roundNumber} value={choice.roundNumber} disabled={!choice.available}>
                  {choice.label}
                  {!choice.available && choice.reason ? ` - ${choice.reason}` : ''}
                </option>
              ))}
            </select>
          </div>

          {hasSelectedRescheduleRound && (
            <div className={adminStyles.startSlotGroup}>
              <label className={adminStyles.startSlotLabel}>New start date</label>
              <select
                className={adminStyles.startSlotSelect}
                value={rescheduleDraft.selectedStartSlotId || ''}
                onChange={(event) => onRescheduleStartSlotIdChange?.(event.target.value)}
                disabled={!onRescheduleStartSlotIdChange || rescheduleDraft.startSlotOptions.length === 0}
              >
                <option value="">Select...</option>
                {rescheduleDropdownOptions.map((option) =>
                  option.kind === 'header' ? (
                    <option key={option.id} value={option.id} disabled>
                      {option.label}
                    </option>
                  ) : (
                    <option
                      key={option.slot.id}
                      value={option.slot.id}
                      disabled={
                        !option.slot.selectable ||
                        !rescheduleValidStartSlotIds.has(option.slot.id) ||
                        option.slot.id === rescheduleDraft.currentStartSlotId
                      }
                    >
                      {formatStartOption(option.slot, {
                        current: option.slot.id === rescheduleDraft.currentStartSlotId,
                      })}
                    </option>
                  ),
                )}
              </select>
              {rescheduleDraft.daysUntilStart !== null &&
                rescheduleDraft.daysUntilStart <= 4 &&
                !(
                  rescheduleDraft.selectedStartSlot && getCupWeekDecoration(rescheduleDraft.selectedStartSlot.htWeek)
                ) && <p className={adminStyles.startSlotWarning}>⚠️ In {rescheduleDraft.daysUntilStart} days</p>}
            </div>
          )}

          {rescheduleDraft.canIncludeWeek15WeekendFriendly && (
            <label className={adminStyles.checkboxLabel}>
              <input
                type="checkbox"
                checked={includeWeek15WeekendFriendlyForReschedule}
                onChange={(event) => onIncludeWeek15WeekendFriendlyForRescheduleChange?.(event.target.checked)}
                disabled={!onIncludeWeek15WeekendFriendlyForRescheduleChange}
              />
              <span>also include week 15 friendly match (possible qualifiers)</span>
            </label>
          )}

          {hasSelectedRescheduleStart &&
            (rescheduleDraft.previousRounds.length > 0 || rescheduleDraft.rounds.length > 0) && (
              <div className={adminStyles.schedulePreview}>
                <h3>Calendar preview</h3>
                {rescheduleDraft.previousRounds.length > 0 && (
                  <>
                    <div className={adminStyles.previewSectionLabel}>Unchanged rounds</div>
                    {rescheduleDraft.previousRounds.map((round) => (
                      <div key={round.roundId} className={`${adminStyles.previewRow} ${adminStyles.previewRowMuted}`}>
                        <div className={`${adminStyles.previewToggle} ${adminStyles.previewToggleStatic}`}>
                          <strong>Round {round.roundNumber}</strong>
                          <span>
                            {round.displayDateLabel ? `• ${round.displayDateLabel}` : '• Date unavailable'}
                            {round.slot
                              ? ` • ${formatSeasonWeek(round.slot, round.slot.kind === 'weekend_friendly')}`
                              : ''}
                          </span>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {rescheduleDraft.rounds.length > 0 && (
                  <div className={adminStyles.previewSectionLabel}>Regenerated rounds</div>
                )}
                {rescheduleDraft.rounds.map((round) => (
                  <div key={round.roundNumber} className={adminStyles.previewRow}>
                    <button
                      type="button"
                      className={adminStyles.previewToggle}
                      onClick={() =>
                        setExpandedRounds((current) => ({
                          ...current,
                          [round.roundNumber]: !current[round.roundNumber],
                        }))
                      }
                    >
                      <strong>Round {round.roundNumber}</strong>
                      <span>
                        • {round.displayDateLabel} •{' '}
                        {formatSeasonWeek(round.slot, round.slot.kind === 'weekend_friendly')}
                      </span>
                    </button>
                    {expandedRounds[round.roundNumber] && (
                      <div className={adminStyles.previewMatches}>
                        {round.matches.map((match) => (
                          <div key={match.matchId}>
                            {match.isBye ? (
                              <>
                                {match.homeTeamName === 'BYE' ? match.awayTeamName : match.homeTeamName}{' '}
                                <span>has a BYE</span>
                              </>
                            ) : (
                              <>
                                {match.homeTeamName}
                                <span> vs</span> {match.awayTeamName}
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

          {rescheduleDraft.valid && rescheduleDraft.rounds[0] && rescheduleLastRound && (
            <div className={adminStyles.scheduleNotice}>
              <h3>Just to check...</h3>
              <span>
                Move <strong>Round {rescheduleDraft.selectedFromRoundNumber}</strong> from{' '}
                <strong>{rescheduleDraft.currentRoundDateLabel || 'its current date'}</strong> to{' '}
                <strong>{formatLongDate(rescheduleDraft.rounds[0].displayDate)}</strong>. Any following rounds will
                follow automatically. Pairings remain unchanged, only dates are rescheduled. Previous rounds are
                unaffected.
              </span>
            </div>
          )}

          {hasSelectedRescheduleRound && !rescheduleDraft.valid && rescheduleDraft.reason && (
            <p className={adminStyles.smallNote}>{rescheduleDraft.reason}</p>
          )}

          {hasSelectedRescheduleStart && (
            <div className={adminStyles.scheduleAction}>
              <Button
                variant="primary"
                size="lg"
                fullWidth
                onClick={onReschedule}
                disabled={!rescheduleDraft.valid || isRescheduling || !onReschedule}
              >
                {isRescheduling ? 'Regenerating...' : 'Regenerate schedule'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className={adminStyles.scheduleLockedState}>
          <p>Altering schedule for running tournaments is currently not possible. Contact app's author.</p>
        </div>
      )}
    </SectionCard>
  );
};
