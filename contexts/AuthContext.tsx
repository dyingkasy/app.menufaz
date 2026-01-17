import React, { createContext, useContext, useEffect, useState } from 'react';
import { getCurrentUser, logout as authLogout, onAuthStateChanged } from '../services/auth';
import { getUserProfile, updateUserProfile, UserProfile } from '../services/db';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: async () => {},
  refreshUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserProfile = async (uid: string, fallback?: { email?: string; role?: string }) => {
    try {
      const profile = await getUserProfile(uid);
      if (profile) {
        const merged: UserProfile = {
          uid,
          email: profile.email || fallback?.email || '',
          role: (profile.role as UserProfile['role']) || (fallback?.role as UserProfile['role']) || 'CLIENT',
          ...profile
        };
        setUser(merged);
        if (!profile.role || !profile.email) {
          await updateUserProfile(uid, { role: merged.role, email: merged.email });
        }
      } else {
        console.warn('Usuário autenticado mas sem perfil local. Realizando logout.');
        await authLogout();
        setUser(null);
      }
    } catch (error) {
      console.error('Error fetching user profile:', error);
      setUser(null);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(async (authUser) => {
      if (authUser) {
        await fetchUserProfile(authUser.uid, { email: authUser.email, role: authUser.role });
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await authLogout();
    setUser(null);
  };

  const refreshUser = async () => {
    const current = getCurrentUser();
    if (current) {
      await fetchUserProfile(current.uid);
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, refreshUser }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
