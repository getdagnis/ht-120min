import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './AuthCallback.module.sass';
import { markAuthRefreshCurrent } from '../utils/auth-refresh';
import { trackActivity } from '../hooks/useActivityTracking';
import {
  isForgeAuthReturnUrl,
  setForgeAuthSession,
  setMainAuthSession,
  stripForgeAuthFlag,
} from '../utils/auth-storage';

export const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    const returnUrl = searchParams.get('returnUrl');
    if (token) {
      const finalizeLogin = async () => {
        try {
          const res = await fetch('/api/auth/complete', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selection_token: token, forgeAuth: isForgeAuthReturnUrl(returnUrl) }),
          });
          
          const data = await res.json();
          if (res.ok) {
            const forgeAuth = isForgeAuthReturnUrl(returnUrl);
            if (forgeAuth) {
              setForgeAuthSession(data.manager_name, data.hattrick_user_id);
            } else {
              setMainAuthSession(data.manager_name, data.hattrick_user_id);
              markAuthRefreshCurrent();
            }
            void trackActivity('login', {
              route: returnUrl ? decodeURIComponent(returnUrl) : '/',
              metadata: { forge: forgeAuth },
            });
            
            // Redirect to the intended page, or the one from backend, or home
            const decodedReturnUrl = returnUrl ? decodeURIComponent(returnUrl) : '';
            window.location.href = decodedReturnUrl ? stripForgeAuthFlag(decodedReturnUrl) : (data.redirect || '/');
          } else {
            console.error('Auth complete failed:', data.error);
            navigate('/');
          }
        } catch (err) {
          console.error('Auth complete fetch error:', err);
          navigate('/');
        }
      };
      void finalizeLogin();
    } else {
      navigate('/');
    }
  }, [searchParams, navigate]);

  return (
    <div className={styles.container}>
      <div className={styles.loading}>
        <h3>Logging you in...</h3>
        <p>Connecting with Hattrick and returning you to where you left off.</p>
      </div>
    </div>
  );
};
