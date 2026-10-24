import { useState } from 'react';
import { Button } from '../../components/Button/Button';
import { SectionCard } from '../../components/Card/SectionCard';
import styles from './Forge.module.sass';

type Draft = { kind: 'survey' | 'announcement'; tournament: string; title: string; body: string; options: string[] };
type Result = { title: string; responses: number; teams: number; answers: { label: string; percent: number }[] };
const tournaments: { name: string; active: Result; past: Result }[] = [
  {
    name: 'Around the World in One Twenty',
    active: { title: 'What brings your team here?', responses: 18, teams: 32, answers: [
      { label: 'Chasing new flags', percent: 44 }, { label: '120-minute matches', percent: 22 },
      { label: 'Both are important', percent: 28 }, { label: 'Fun and friendlies', percent: 6 },
    ] },
    past: { title: 'Season 1 check-in', responses: 29, teams: 32, answers: [
      { label: 'Keep the format', percent: 62 }, { label: 'More rounds', percent: 28 }, { label: 'Fewer rounds', percent: 10 },
    ] },
  },
  {
    name: 'Friday Friendlies',
    active: { title: 'Preferred match rhythm', responses: 24, teams: 30, answers: [
      { label: 'Weekly', percent: 71 }, { label: 'Every other week', percent: 21 }, { label: 'Flexible', percent: 8 },
    ] },
    past: { title: 'Season 2 check-in', responses: 21, teams: 30, answers: [
      { label: 'Current time works', percent: 71 }, { label: 'Earlier', percent: 19 }, { label: 'Later', percent: 10 },
    ] },
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
  const canSave = draft.tournament.trim() && draft.title.trim() && draft.body.trim()
    && (draft.kind === 'announcement' || draft.options.filter((option) => option.trim()).length >= 2);
  const save = () => {
    if (!canSave) return;
    setDrafts((current) => [{ ...draft, options: draft.options.map((option) => option.trim()).filter(Boolean) }, ...current]);
    setDraft(emptyDraft());
    setEditing(false);
  };

  return (
    <div className={styles.sectionStack}>
      <div className={styles.dashboardHeading}>
        <h1 className={styles.pageTitle}>Surveys</h1>
        <Button onClick={() => setEditing((current) => !current)}>{editing ? 'Close editor' : 'Create draft'}</Button>
      </div>
      <p className={styles.smallNote}>Example results. Drafts remain on this page only; nothing is published or saved.</p>
      {editing && <SectionCard title="Create a survey or announcement" className={styles.surfaceCard}>
        <div className={styles.sectionStack}>
          <div>
            <Button variant={draft.kind === 'survey' ? 'primary' : 'outline'} onClick={() => setDraft({ ...draft, kind: 'survey' })}>Survey</Button>{' '}
            <Button variant={draft.kind === 'announcement' ? 'primary' : 'outline'} onClick={() => setDraft({ ...draft, kind: 'announcement' })}>Announcement</Button>
          </div>
          <label>Tournament<br /><input className={styles.dashboardSearch} value={draft.tournament} onChange={(event) => setDraft({ ...draft, tournament: event.target.value })} placeholder="Tournament name" /></label>
          <label>Title<br /><input className={styles.dashboardSearch} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Title" /></label>
          <label>{draft.kind === 'survey' ? 'Question' : 'Message'}<br /><textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} rows={3} /></label>
          {draft.kind === 'survey' && <div>
            <p>Answer options</p>
            {draft.options.map((option, index) => <div key={index}>
              <input className={styles.dashboardSearch} aria-label={`Option ${index + 1}`} value={option} onChange={(event) => setDraft({ ...draft, options: draft.options.map((value, i) => i === index ? event.target.value : value) })} placeholder={`Option ${index + 1}`} />{' '}
              {draft.options.length > 2 && <Button variant="outline" onClick={() => setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })}>Remove</Button>}
            </div>)}
            <Button variant="outline" onClick={() => setDraft({ ...draft, options: [...draft.options, ''] })}>Add option</Button>
          </div>}
          <Button disabled={!canSave} onClick={save}>Keep draft on this page</Button>
        </div>
      </SectionCard>}
      {drafts.length > 0 && <SectionCard title="Drafts" className={styles.surfaceCard}>
        {drafts.map((item, index) => <p key={index}><strong>{item.title}</strong> · {item.tournament} · {item.kind}</p>)}
      </SectionCard>}
      <SectionCard title="Tournaments with active surveys" className={styles.surfaceCard}>
        {tournaments.map((item, index) => <p key={item.name}>
          <Button variant={selectedTournament === index ? 'primary' : 'outline'} onClick={() => { setSelectedTournament(index); setSelectedSurvey('active'); }}>{item.name}</Button>
        </p>)}
      </SectionCard>
      <SectionCard title={tournament.name} subtitle="Example results" className={styles.surfaceCard}>
        <p><Button variant={selectedSurvey === 'active' ? 'primary' : 'outline'} onClick={() => setSelectedSurvey('active')}>Active survey</Button>{' '}
          <Button variant={selectedSurvey === 'past' ? 'primary' : 'outline'} onClick={() => setSelectedSurvey('past')}>Past survey</Button></p>
        <h2>{result.title}</h2>
        <p>{result.responses} of {result.teams} teams responded</p>
        {result.answers.map((answer) => <div key={answer.label}>
          <label>{answer.label}: {answer.percent}% <progress value={answer.percent} max={100}>{answer.percent}%</progress></label>
        </div>)}
      </SectionCard>
    </div>
  );
}
