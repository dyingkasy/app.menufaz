import { UserRole } from '../types';

export interface AuthUser {
  uid: string;
  email: string;
  password: string;
  role: UserRole;
}

type AuthListener = (user: AuthUser | null) => void;

const STORAGE_PREFIX = 'menufaz_';
const CURRENT_USER_KEY = `${STORAGE_PREFIX}current_user`;
const TOKEN_KEY = `${STORAGE_PREFIX}auth_token`;
const USERS_KEY = `${STORAGE_PREFIX}users`;

const listeners = new Set<AuthListener>();
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const notify = () => {
  const user = getCurrentUser();
  listeners.forEach((listener) => listener(user));
};

const setCurrentUser = (user: AuthUser | null, token?: string) => {
  if (user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }

  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else if (!user) {
    localStorage.removeItem(TOKEN_KEY);
  }

  notify();
};

const getUsers = (): AuthUser[] => {
  const raw = localStorage.getItem(USERS_KEY);
  return raw ? (JSON.parse(raw) as AuthUser[]) : [];
};

const apiFetch = async (path: string, options: RequestInit) => {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  if (!response.ok) {
    const error: any = new Error('Request failed');
    error.code = response.status;
    throw error;
  }
  return response.json();
};

export const onAuthStateChanged = (listener: AuthListener) => {
  listeners.add(listener);
  listener(getCurrentUser());
  return () => listeners.delete(listener);
};

export const getCurrentUser = (): AuthUser | null => {
  const raw = localStorage.getItem(CURRENT_USER_KEY);
  if (!raw) return null;
  return JSON.parse(raw) as AuthUser;
};

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

export const login = async (email: string, password: string): Promise<AuthUser> => {
  if (!API_BASE_URL) {
    const users = getUsers();
    const user = users.find((u) => u.email === email && u.password === password);
    if (!user) {
      const error: any = new Error('Invalid credentials');
      error.code = 'auth/invalid-credential';
      throw error;
    }
    setCurrentUser(user);
    return user;
  }

  try {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const user: AuthUser = {
      uid: data.user?.id || data.user?.uid,
      email: data.user?.email || email,
      password,
      role: data.user?.role || 'CLIENT'
    };
    setCurrentUser(user, data.token);
    return user;
  } catch (err: any) {
    const error: any = new Error('Invalid credentials');
    error.code = 'auth/invalid-credential';
    throw error;
  }
};

export const register = async (user: AuthUser): Promise<AuthUser> => {
  if (!API_BASE_URL) {
    const users = getUsers();
    if (users.some((u) => u.email === user.email)) {
      const error: any = new Error('Email already in use');
      error.code = 'auth/email-already-in-use';
      throw error;
    }
    users.push(user);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    setCurrentUser(user);
    return user;
  }

  try {
    const data = await apiFetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        password: user.password,
        role: user.role,
        profile: {}
      })
    });
    const created: AuthUser = {
      uid: data.user?.id || data.user?.uid,
      email: data.user?.email || user.email,
      password: user.password,
      role: data.user?.role || user.role
    };
    setCurrentUser(created, data.token);
    return created;
  } catch (err: any) {
    const error: any = new Error('Email already in use');
    error.code = 'auth/email-already-in-use';
    throw error;
  }
};

export const logout = async () => {
  setCurrentUser(null);
};

export const sendPasswordResetEmail = async (_email: string) => {
  if (!API_BASE_URL) {
    const users = getUsers();
    const exists = users.some((u) => u.email === _email);
    if (!exists) {
      const error: any = new Error('User not found');
      error.code = 'auth/user-not-found';
      throw error;
    }
  }
};

export const setAuthUser = (user: AuthUser) => {
  const users = getUsers();
  const existingIndex = users.findIndex((u) => u.uid === user.uid);
  if (existingIndex >= 0) {
    users[existingIndex] = user;
  } else {
    users.push(user);
  }
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  setCurrentUser(user);
};
