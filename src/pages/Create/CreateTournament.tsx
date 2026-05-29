import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { nanoid } from 'nanoid';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card/Card';
import styles from './CreateTournament.module.scss';

export const CreateTournament: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    scoring_mode: '120m',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const slug = formData.slug || nanoid(10);
    const adminPassword = nanoid(8);

    const { error } = await supabase
      .from('tournaments')
      .insert([
        {
          name: formData.name,
          slug,
          scoring_mode: formData.scoring_mode,
          admin_password: adminPassword,
        },
      ])
      .select()
      .single();

    if (error) {
      alert('Error creating tournament: ' + error.message);
      setLoading(false);
    } else {
      // Store password in localStorage for convenience
      localStorage.setItem(`admin_pw_${slug}`, adminPassword);
      navigate(`/t/${slug}/admin`, { state: { password: adminPassword, isNew: true } });
    }
  };

  return (
    <div className={styles.container}>
      <h1>Create Tournament</h1>
      <Card>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="name">Tournament Name</label>
            <input
              id="name"
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g. Summer Cup 2026"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="slug">Custom URL Slug (optional)</label>
            <input
              id="slug"
              type="text"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
              placeholder="e.g. summer-cup"
            />
            <small>Leave empty to generate automatically.</small>
          </div>

          <div className={styles.field}>
            <label htmlFor="scoring_mode">Scoring Mode</label>
            <select
              id="scoring_mode"
              value={formData.scoring_mode}
              onChange={(e) => setFormData({ ...formData, scoring_mode: e.target.value })}
            >
              <option value="120m">120 Minute Training Achievements</option>
              <option value="points">Standard Victory Points (3/1/0)</option>
            </select>
          </div>

          <div className={styles.actions}>
            <Button type="submit" disabled={loading} fullWidth>
              {loading ? 'Creating...' : 'Create Tournament'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
