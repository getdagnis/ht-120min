import React from 'react';
import { Info } from 'phosphor-react';
import { Button } from '../../Button/Button';
import { SectionCard } from '../../Card/SectionCard';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';
import {
  formatCalendarDate,
  getCalendarWeekdayLabel,
} from '../../../utils/hattrick-calendar';
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

export const TournamentSchedulePanel: React.FC<TournamentSchedulePanelProps> = ({
  isGenerated,
  isCollapsed,
  onToggleCollapse,
  draft,
  onScheduleModeChange,
  onSelectedStartSlotIdChange,
  isGenerating,
  onGenerate,
  generatedSummary,
}) => {
  const subtitle =
    draft.selectedStartSlot && draft.daysUntilStart != null
      ? `Generate a schedule with ${draft.teamCount} teams. Closest start date: ${formatCalendarDate(draft.selectedStartSlot.nominalDate)}, HT week S${draft.selectedStartSlot.htSeason} W${draft.selectedStartSlot.htWeek} (in ${draft.daysUntilStart} day${draft.daysUntilStart === 1 ? '' : 's'}).`
      : `${draft.teamCount} teams • No valid start window found`;

  return (
    <SectionCard
      title="Generate a schedule"
      subtitle={<span className={adminStyles.smallNote}>{subtitle}</span>}
      className={adminStyles.scheduleCard}
      collapsible
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      {!isGenerated ? (
        <div className={adminStyles.genOptions}>
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
                  {!option.available && <span className={adminStyles.smallNote}>{formatModeReason(option.reason)}</span>}
                </div>
              </label>
            ))}
          </div>

          <div className={adminStyles.startSlotGroup}>
            <label className={adminStyles.startSlotLabel}>Start date</label>
            <select
              className={adminStyles.startSlotSelect}
              value={draft.selectedStartSlotId || ''}
              onChange={(e) => onSelectedStartSlotIdChange(e.target.value)}
              disabled={draft.startSlotOptions.length === 0}
            >
              {draft.startSlotOptions.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {formatCalendarDate(slot.nominalDate)} • HT S{slot.htSeason} W{slot.htWeek} •{' '}
                  {getCalendarWeekdayLabel(slot.kind)}
                </option>
              ))}
            </select>
            <p className={adminStyles.smallNote}>
              Choose the round 1 slot. The schedule then consumes the next allowed calendar slots in order.
            </p>
            {draft.selectedStartSlot && (
              <p className={adminStyles.smallNote}>
                Selected slot: HT S{draft.selectedStartSlot.htSeason} W{draft.selectedStartSlot.htWeek} (
                {getCalendarWeekdayLabel(draft.selectedStartSlot.kind)})
              </p>
            )}
          </div>

          {draft.rounds.length > 0 && (
            <div className={adminStyles.schedulePreview}>
              {draft.rounds.map((round) => (
                <div key={round.roundNumber} className={adminStyles.previewRow}>
                  <strong>Round {round.roundNumber}</strong>
                  <span>
                    {round.slotLabel} • {round.displayDateLabel} • HT S{round.slot.htSeason} W{round.slot.htWeek}
                  </span>
                  <div className={adminStyles.smallNote}>
                    {round.matches.map((match) => (
                      <div key={`${round.roundNumber}-${match.homeTeamId}-${match.awayTeamId}`}>
                        {match.homeTeamName} vs {match.awayTeamName} • {formatCalendarDate(match.scheduledFor)} •{' '}
                        {match.venueType}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {draft.consumesWeek15WeekendFriendly && (
            <div className={adminStyles.scheduleNotice}>
              <Info size={14} />
              <span>Week 15 consumes the extra weekend friendly slot between the midweek and Week 16 rounds.</span>
            </div>
          )}

          {draft.warnings.length > 0 && (
            <div className={adminStyles.scheduleNotice}>
              <Info size={14} />
              <div>
                {draft.warnings.map((warning) => (
                  <p key={warning} className={adminStyles.smallNote}>
                    {warning}
                  </p>
                ))}
              </div>
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

          <Button variant="primary" size="lg" fullWidth onClick={onGenerate} disabled={!draft.valid || isGenerating}>
            Generate a schedule
          </Button>

          <p className="center w-100">Generating a schedule also closes registration and locks the selected start.</p>
        </div>
      ) : (
        <div className={adminStyles.scheduleLockedState}>
          <p className={adminStyles.smallNote}>
            Existing generated tournaments are read-only. Legacy `scheduled_for` values remain the source of truth for
            loaded fixtures.
          </p>
          <p className={adminStyles.smallNote}>
            Legacy partial-rescheduling controls are temporarily disabled while the new planner is hardened.
          </p>
          {generatedSummary?.scheduleGeneratedAt && (
            <p className={adminStyles.smallNote}>
              Schedule generated at {new Date(generatedSummary.scheduleGeneratedAt).toLocaleString()}
            </p>
          )}
          {generatedSummary?.scheduleStartSlot && (
            <p className={adminStyles.smallNote}>
              Start slot: {new Date(generatedSummary.scheduleStartSlot).toLocaleString()}
            </p>
          )}
          {generatedSummary?.scheduleMode && <p className={adminStyles.smallNote}>Mode: {generatedSummary.scheduleMode}</p>}
        </div>
      )}
    </SectionCard>
  );
};
