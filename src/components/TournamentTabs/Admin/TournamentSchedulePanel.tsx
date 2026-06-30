import React, { useState } from 'react';
import { Info } from 'phosphor-react';
import { Button } from '../../Button/Button';
import { SectionCard } from '../../Card/SectionCard';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';
import { formatCalendarDate } from '../../../utils/hattrick-calendar';
import type { ScheduleDraftPreview, ScheduleMode } from '../../../utils/schedule-draft';

interface TournamentSchedulePanelProps {
  isGenerated: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  draft: ScheduleDraftPreview;
  onScheduleModeChange: (mode: ScheduleMode) => void;
  onSelectedStartSlotIdChange: (value: string) => void;
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

function formatStartOption(slot: ScheduleDraftPreview['startSlotOptions'][number]) {
  if (!slot.selectable && slot.kind === 'blocked_cup_week') {
    return `🗓 Week ${slot.htWeek} / ${formatShortDate(slot.nominalDate)} • ⛔️ Cup`;
  }
  const cupLikely = slot.htWeek === 3 || slot.htWeek === 4 ? ' • ⚠️ Cup Likely' : '';
  const weekend = slot.kind === 'week15_weekend_friendly' ? ' (weekend-friendly)' : '';
  return `🗓 Week ${slot.htWeek} / ${formatShortDate(slot.nominalDate)}${weekend}${cupLikely}`;
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
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
    .format(date)
    .replace(/\//g, '.');
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
  isGenerating,
  onGenerate,
  tournamentTeamLimit,
}) => {
  const [expandedRounds, setExpandedRounds] = useState<Record<number, boolean>>({});
  const plannerTeamCount = getPlannerTeamCount(draft, tournamentTeamLimit);
  const selectedStartWarning =
    draft.selectedStartSlot && (draft.selectedStartSlot.htWeek === 3 || draft.selectedStartSlot.htWeek === 4)
      ? null
      : getSelectedStartWarning(draft.daysUntilStart);
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
  const lastRound = draft.rounds[draft.rounds.length - 1] || null;

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
            <label className={adminStyles.startSlotLabel}>Choose start date</label>
            <select
              className={adminStyles.startSlotSelect}
              value={draft.selectedStartSlotId || ''}
              onChange={(e) => onSelectedStartSlotIdChange(e.target.value)}
              disabled={draft.startSlotOptions.length === 0}
            >
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

          {draft.rounds.length > 0 && (
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
                    <strong>Round {round.roundNumber}</strong>
                    <span>
                      {round.displayDateLabel} •{' '}
                      {formatSeasonWeek(round.slot, round.slot.kind === 'week15_weekend_friendly')}
                    </span>
                  </button>
                  {expandedRounds[round.roundNumber] && (
                    <div className={adminStyles.previewMatches}>
                      {round.matches.map((match) => (
                        <div key={`${round.roundNumber}-${match.homeTeamId}-${match.awayTeamId}`}>
                          {match.isBye
                            ? `${match.homeTeamName === 'BYE' ? match.awayTeamName : match.homeTeamName} has a BYE`
                            : `${match.homeTeamName} vs ${match.awayTeamName}`}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {draft.valid && draft.selectedStartSlot && lastRound && (
            <div className={adminStyles.scheduleNotice}>
              <span>
                Generate a schedule for a{' '}
                <strong>
                  {plannerTeamCount} team {formatModeSummary(draft.mode)}
                </strong>{' '}
                tournament that will start on <strong>{formatLongDate(draft.selectedStartSlot.nominalDate)}</strong> and
                last for <strong>{draft.roundCount} rounds</strong> with the last round played on{' '}
                <strong>{formatLongDate(lastRound.displayDate)}</strong>.
              </span>
            </div>
          )}

          {!draft.valid && draft.reason && <p className={adminStyles.smallNote}>{draft.reason}</p>}
          {!draft.valid && draft.blockingReasons.length > 0 && (
            <div className={adminStyles.scheduleNotice}>
              <Info size={14} />
              <div>
                {draft.blockingReasons.map((reason) => (
                  <p key={reason} className={adminStyles.smallNote}>
                    {reason}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className={adminStyles.scheduleAction}>
            <Button variant="primary" size="lg" fullWidth onClick={onGenerate} disabled={!draft.valid || isGenerating}>
              Generate a schedule
            </Button>
          </div>

          <p className="center w-100">Generating a schedule also closes registration and locks the selected start.</p>
        </div>
      ) : (
        <div className={adminStyles.scheduleLockedState}>
          <p>Altering schedule for running tournaments is currently not possible. Contact app's author.</p>
        </div>
      )}
    </SectionCard>
  );
};
