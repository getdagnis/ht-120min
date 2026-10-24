import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import { getCountryWorldDetails } from '../../../shared/worlddetails';
import styles from './Forge.module.sass';
import surveyStyles from './ForgeSurveys.module.sass';

type Draft = { kind: 'survey' | 'announcement'; tournament: string; title: string; body: string; options: string[] };
type TeamResponse = { team: string; countryId: number; answer: string; comments?: string };
type ManagerResponse = {
  manager: string;
  countryId: number;
  completedAt: string;
  teams: TeamResponse[];
  importance?: string;
};
type Result = { title: string; totalTeams: number; options: string[]; managers: ManagerResponse[] };
const teamPriorityOptions = [
  '🇲🇵 Collecting new flags',
  '⏱ 120-minute matches',
  '🖇 Both are equally important to this team',
  "🥂 It's here for challenge, fun and no-hassle friendlies",
];
const managerImportanceOptions = [
  '☝️ Highly important',
  '👌 Nice to have',
  '⚽️ Depends on team or current training plan',
  "🏛 I'd prefer regular matches",
];
function numberedAnswer(options: string[], answer: string) {
  const index = options.indexOf(answer);
  return index < 0 ? answer : `${index + 1}. ${answer}`;
}
const completionDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Riga',
});
const tournaments: { name: string; active: Result; past: Result }[] = [
  {
    name: 'Around the World in One Twenty',
    active: {
      title: 'What brings your team here?',
      totalTeams: 8,
      options: teamPriorityOptions,
      managers: [
        {
          manager: 'mr_bots',
          countryId: 48,
          completedAt: '2026-10-24T10:12:00Z',
          importance: managerImportanceOptions[0],
          teams: [
            {
              team: 'Guåhan Goddess',
              countryId: 179,
              answer: teamPriorityOptions[2],
              comments: 'Happy to play new countries.',
            },
            { team: 'Guåhan HFI', countryId: 179, answer: teamPriorityOptions[0] },
          ],
        },
        {
          manager: 'FriendlyFan',
          countryId: 16,
          completedAt: '2026-10-23T18:45:00Z',
          importance: managerImportanceOptions[1],
          teams: [
            { team: 'Coastal United', countryId: 16, answer: teamPriorityOptions[0] },
            {
              team: 'Coastal HFI',
              countryId: 16,
              answer: teamPriorityOptions[1],
              comments: 'Prefer Wednesdays when possible.',
            },
          ],
        },
        {
          manager: 'Coach Vega',
          countryId: 2,
          completedAt: '2026-10-22T09:30:00Z',
          importance: managerImportanceOptions[2],
          teams: [{ team: 'North End', countryId: 2, answer: teamPriorityOptions[3] }],
        },
      ],
    },
    past: {
      title: 'Season 1 check-in',
      totalTeams: 8,
      options: ['Keep the format', 'More rounds', 'Fewer rounds'],
      managers: [
        {
          manager: 'mr_bots',
          countryId: 48,
          completedAt: '2026-08-12T12:00:00Z',
          teams: [
            { team: 'Guåhan Goddess', countryId: 179, answer: 'Keep the format' },
            { team: 'Guåhan HFI', countryId: 179, answer: 'More rounds' },
          ],
        },
        {
          manager: 'FriendlyFan',
          countryId: 16,
          completedAt: '2026-08-11T12:00:00Z',
          teams: [{ team: 'Coastal United', countryId: 16, answer: 'Keep the format' }],
        },
      ],
    },
  },
  {
    name: 'Friday Friendlies',
    active: {
      title: 'Preferred match rhythm',
      totalTeams: 6,
      options: ['Weekly', 'Every other week', 'Flexible'],
      managers: [
        {
          manager: 'FridayCoach',
          countryId: 12,
          completedAt: '2026-10-24T08:10:00Z',
          teams: [
            { team: 'Friday Rovers', countryId: 12, answer: 'Weekly' },
            { team: 'Friday HFI', countryId: 12, answer: 'Flexible', comments: 'Can arrange around training.' },
          ],
        },
        {
          manager: 'AwayDays',
          countryId: 15,
          completedAt: '2026-10-23T19:20:00Z',
          teams: [{ team: 'Saturday City', countryId: 15, answer: 'Every other week' }],
        },
      ],
    },
    past: {
      title: 'Season 2 check-in',
      totalTeams: 6,
      options: ['Current time works', 'Earlier', 'Later'],
      managers: [
        {
          manager: 'FridayCoach',
          countryId: 12,
          completedAt: '2026-08-13T12:00:00Z',
          teams: [
            { team: 'Friday Rovers', countryId: 12, answer: 'Current time works' },
            { team: 'Friday HFI', countryId: 12, answer: 'Earlier' },
          ],
        },
        {
          manager: 'AwayDays',
          countryId: 15,
          completedAt: '2026-08-12T12:00:00Z',
          teams: [{ team: 'Saturday City', countryId: 15, answer: 'Current time works' }],
        },
      ],
    },
  },
];
const emptyDraft = (): Draft => ({ kind: 'survey', tournament: '', title: '', body: '', options: ['', ''] });

export function ForgeSurveys() {
  const [selectedTournament, setSelectedTournament] = useState(0);
  const [selectedSurvey, setSelectedSurvey] = useState<'active' | 'past'>('active');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const tournament = tournaments[selectedTournament];
  const result = tournament[selectedSurvey];
  const teamResponses = result.managers.flatMap((manager) => manager.teams);
  const answerCounts = result.options.map((option) => ({
    label: option,
    count: teamResponses.filter((team) => team.answer === option).length,
  }));
  const canSave =
    draft.tournament.trim() &&
    draft.title.trim() &&
    draft.body.trim() &&
    (draft.kind === 'announcement' || draft.options.filter((option) => option.trim()).length >= 2);
  const save = () => {
    if (!canSave) return;
    setDrafts((current) => [
      { ...draft, options: draft.options.map((option) => option.trim()).filter(Boolean) },
      ...current,
    ]);
    setDraft(emptyDraft());
    setEditing(false);
  };

  return (
    <div className={styles.sectionStack}>
      <div className={styles.dashboardHeading}>
        <h1 className={styles.pageTitle}>Surveys</h1>
      </div>
      <div className={styles.analyticsLayout}>
        <div className={styles.analyticsMain}>
          {editing && (
            <SectionCard title="Create a survey or announcement" className={styles.surfaceCard}>
              <div className={styles.sectionStack}>
                <div>
                  <Button
                    variant={draft.kind === 'survey' ? 'primary' : 'outline'}
                    onClick={() => setDraft({ ...draft, kind: 'survey' })}
                  >
                    Survey
                  </Button>{' '}
                  <Button
                    variant={draft.kind === 'announcement' ? 'primary' : 'outline'}
                    onClick={() => setDraft({ ...draft, kind: 'announcement' })}
                  >
                    Announcement
                  </Button>
                </div>
                <label>
                  Tournament
                  <br />
                  <input
                    className={styles.dashboardSearch}
                    value={draft.tournament}
                    onChange={(event) => setDraft({ ...draft, tournament: event.target.value })}
                    placeholder="Tournament name"
                  />
                </label>
                <label>
                  Title
                  <br />
                  <input
                    className={styles.dashboardSearch}
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    placeholder="Title"
                  />
                </label>
                <label>
                  {draft.kind === 'survey' ? 'Question' : 'Message'}
                  <br />
                  <textarea
                    value={draft.body}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    rows={3}
                  />
                </label>
                {draft.kind === 'survey' && (
                  <div>
                    <p>Answer options</p>
                    {draft.options.map((option, index) => (
                      <div key={index}>
                        <input
                          className={styles.dashboardSearch}
                          aria-label={`Option ${index + 1}`}
                          value={option}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              options: draft.options.map((value, i) => (i === index ? event.target.value : value)),
                            })
                          }
                          placeholder={`Option ${index + 1}`}
                        />{' '}
                        {draft.options.length > 2 && (
                          <Button
                            variant="outline"
                            onClick={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ))}
                    <Button variant="outline" onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}>
                      Add option
                    </Button>
                  </div>
                )}
                <Button disabled={!canSave} onClick={save}>
                  Keep draft on this page
                </Button>
              </div>
            </SectionCard>
          )}
          <SectionCard title={tournament.name} className={styles.surfaceCard}>
            <h2 className={surveyStyles.surveyTitle}>{result.title}</h2>
            <div className={surveyStyles.resultList}>
              {result.managers.map((manager) => (
                <article className={surveyStyles.managerResult} key={manager.manager}>
                  <div className={surveyStyles.managerHeading}>
                    <h3>
                      <span aria-hidden="true">{getCountryWorldDetails(manager.countryId)?.emoji || '🌐'}</span>{' '}
                      {manager.manager}
                    </h3>
                    <time dateTime={manager.completedAt}>{completionDate.format(new Date(manager.completedAt))}</time>
                  </div>
                  <ul className={surveyStyles.teamAnswers}>
                    {manager.teams.map((team) => (
                      <li key={team.team}>
                        <div className={surveyStyles.teamAnswer}>
                          <strong>
                            <span aria-hidden="true">{getCountryWorldDetails(team.countryId)?.emoji || '🌐'}</span>{' '}
                            {team.team}
                          </strong>
                          <span>{numberedAnswer(result.options, team.answer)}</span>
                        </div>
                        {team.comments && <p className={surveyStyles.comments}>{team.comments}</p>}
                      </li>
                    ))}
                  </ul>
                  {manager.importance && (
                    <p className={surveyStyles.managerAnswer}>
                      120-minute matches: {numberedAnswer(managerImportanceOptions, manager.importance)}
                    </p>
                  )}
                </article>
              ))}
            </div>
          </SectionCard>
        </div>
        <aside className={styles.statsSidebar}>
          <SectionCard title="Survey controls" className={styles.surfaceCard}>
            <div className={styles.sectionStack}>
              <div className={surveyStyles.controlGroup}>
                <strong>Tournament</strong>
                {tournaments.map((item, index) => (
                  <Button
                    key={item.name}
                    variant={selectedTournament === index ? 'primary' : 'outline'}
                    onClick={() => {
                      setSelectedTournament(index);
                      setSelectedSurvey('active');
                    }}
                  >
                    {item.name}
                  </Button>
                ))}
              </div>
              <div className={surveyStyles.controlGroup}>
                <strong>Survey</strong>
                <Button
                  variant={selectedSurvey === 'active' ? 'primary' : 'outline'}
                  onClick={() => setSelectedSurvey('active')}
                >
                  Active survey
                </Button>
                <Button
                  variant={selectedSurvey === 'past' ? 'primary' : 'outline'}
                  onClick={() => setSelectedSurvey('past')}
                >
                  Past survey
                </Button>
              </div>
            </div>
          </SectionCard>
          <SectionCard title="Response summary" className={styles.surfaceCard}>
            <p>
              {teamResponses.length} of {result.totalTeams} teams · {result.managers.length} managers
            </p>
            <div className={surveyStyles.answerCounts}>
              {answerCounts.map((answer, index) => (
                <div key={answer.label}>
                  <span>
                    {index + 1}. {answer.label}: {answer.count}
                  </span>
                  <progress value={answer.count} max={teamResponses.length}>
                    {answer.count} of {teamResponses.length}
                  </progress>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard title="Drafts" className={styles.surfaceCard}>
            <p className={styles.smallNote}>Drafts stay on this page. Nothing is published or saved.</p>
            <Button onClick={() => setEditing((current) => !current)}>
              {editing ? 'Close editor' : 'Create draft'}
            </Button>
            {drafts.map((item, index) => (
              <p key={index}>
                <strong>{item.title}</strong> · {item.tournament} · {item.kind}
              </p>
            ))}
          </SectionCard>
        </aside>
      </div>
    </div>
  );
}
