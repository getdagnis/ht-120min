import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export const AuthCallback = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = searchParams.get('token');
    if (token) {
      const finalizeLogin = async () => {
        try {
          const res = await fetch('/api/auth/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selection_token: token }),
          });
          
          const data = await res.json();
          if (res.ok) {
            localStorage.setItem('my_ht_manager_name', data.manager_name);
            localStorage.setItem('my_ht_user_id', String(data.hattrick_user_id));
            
            // Redirect to the intended page or home
            window.location.href = data.redirect || '/';
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

  return <div>Logging in...</div>;
};
