import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setAuthToken } from '../services/api';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    try {
      const data = await api.get('/auth/me', { skipAuthRedirect: true });
      const currentUser = data?.user ?? null;
      setUser(currentUser);
      setProfile(currentUser);
      return currentUser;
    } catch {
      setAuthToken(null);
      setUser(null);
      setProfile(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    refreshProfile().finally(() => {
      if (active) setLoading(false);
    });

    const handleUnauthorized = () => {
      setUser(null);
      setProfile(null);
    };

    window.addEventListener('sga:unauthorized', handleUnauthorized);
    return () => {
      active = false;
      window.removeEventListener('sga:unauthorized', handleUnauthorized);
    };
  }, [refreshProfile]);

  const setSession = useCallback((token, currentUser) => {
    if (token) setAuthToken(token);
    setUser(currentUser ?? null);
    setProfile(currentUser ?? null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout', {}, { skipAuthRedirect: true });
    } catch {
      // Limpa sessão local mesmo se a chamada de logout falhar
    } finally {
      setAuthToken(null);
      setUser(null);
      setProfile(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, refreshProfile, setSession }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
