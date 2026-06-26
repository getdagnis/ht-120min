import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styles from './AuthCallback.module.sass';

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
            body: JSON.stringify({ selection_token: token }),
          });
          
          const data = await res.json();
          if (res.ok) {
            localStorage.setItem('my_ht_manager_name', data.manager_name);
            localStorage.setItem('my_ht_user_id', String(data.hattrick_user_id));
            
            // Redirect to the intended page, or the one from backend, or home
            window.location.href = returnUrl ? decodeURIComponent(returnUrl) : (data.redirect || '/');
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
