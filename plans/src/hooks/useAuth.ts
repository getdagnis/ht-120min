import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { calculateMatchDate } from '../utils/ht-data';

// ... (keep interfaces AvatarLayer, Avatar, UserProfile, ActiveTournament, DBTeamMatch, DBRound, DBTournament, DBTeamJoin, DBWarning)

export const useAuth = () => {
  // ... (keep states: managerName, profile, activeTournaments, loading)

  const fetchProfile = useCallback(async (uid: number) => {
    setLoading(true);
    try {
      // 1. Fetch Profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('hattrick_user_id', uid)
        .maybeSingle();

      // NEW: Auto-initialize profile if missing
      if (!profileData) {
        console.log('Profile missing, attempting auto-sync...');
        // We'll rely on the backend /api/auth/complete or a new refresh endpoint to sync this.
        // For now, let's keep the UI in "not logged in" state if profile is missing.
        setProfile(null);
        setLoading(false);
        return;
      }

      setProfile(profileData as UserProfile);

      // 2. Fetch Active Tournaments (as before)
      // ... (keep tournament fetching logic)
    } catch (err) {
      console.error('Error fetching profile:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ... (keep useEffect, logout, return)
};
