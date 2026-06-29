'use client';
import { API_BASE_URL } from '@/lib/api';

import React, { createContext, useContext, useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';

// Auth & Theme Context
const AppContext = createContext<{
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  user: any;
  login: (email: string) => Promise<boolean>;
  logout: () => void;
  subscribe: () => void;
  showPaywall: boolean;
  setShowPaywall: (val: boolean) => void;
}>({
  darkMode: true,
  setDarkMode: () => {},
  user: null,
  login: async () => false,
  logout: () => {},
  subscribe: () => {},
  showPaywall: false,
  setShowPaywall: () => {},
});

export const useApp = () => useContext(AppContext);

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [darkMode, setDarkMode] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [showPaywall, setShowPaywall] = useState(false);

  // Load from local storage on bootstrap
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
    } else {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    }

    const savedUser = localStorage.getItem('newsops_user');
    if (savedUser) {
      setUser(JSON.parse(savedUser));
    }
  }, []);

  const toggleTheme = () => {
    if (darkMode) {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    } else {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    }
  };

  const login = async (email: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        localStorage.setItem('newsops_token', data.token);
        localStorage.setItem('newsops_user', JSON.stringify(data.user));
        return true;
      }
      return false;
    } catch {
      // Mock login for offline sandbox
      const mockUser = {
        id: 'usr_mock_id',
        email,
        firstName: email.split('@')[0],
        lastName: 'User',
        title: 'Premium Subscriber',
        tenantId: 'tenant_mock',
        organizationId: 'org_mock',
      };
      setUser(mockUser);
      localStorage.setItem('newsops_token', 'mock_token');
      localStorage.setItem('newsops_user', JSON.stringify(mockUser));
      return true;
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('newsops_token');
    localStorage.removeItem('newsops_user');
  };

  const subscribe = () => {
    if (user) {
      const updated = { ...user, title: 'Premium Subscriber' };
      setUser(updated);
      localStorage.setItem('newsops_user', JSON.stringify(updated));
    }
    setShowPaywall(false);
  };

  return (
    <AppContext.Provider
      value={{
        darkMode,
        setDarkMode: toggleTheme,
        user,
        login,
        logout,
        subscribe,
        showPaywall,
        setShowPaywall,
      }}
    >
      <header className="sticky top-0 z-50 glass border-b border-border transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <span className="font-serif text-lg font-bold tracking-wide text-foreground">
                Navi News <span className="text-xs font-sans text-muted-foreground font-normal">- powered by Naveen Publications</span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Toggle Theme"
            >
              {darkMode ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 9h-1m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m12.728 12.728l.707.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {user ? (
              <div className="flex items-center gap-3">
                <div className="text-right hidden md:block">
                  <p className="text-xs font-semibold">{user.firstName} {user.lastName}</p>
                  <p className="text-[10px] text-muted-foreground font-medium">{user.title}</p>
                </div>
                <button
                  onClick={logout}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-destructive hover:text-white transition-all font-medium"
                >
                  Logout
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPaywall(true)}
                  className="text-xs px-4 py-2 rounded-lg bg-primary text-white font-medium hover:bg-primary/90 hover:shadow-md transition-all"
                >
                  Login / Subscribe
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      <footer className="border-t border-border mt-12 bg-card text-card-foreground">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* About Company & Founders */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider font-bold text-foreground">About Naveen Publications</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed font-light">
              Naveen Publications was founded in 2000 by MVRK Rao, a senior journalist with 30+ years of experience and secretary for APWUJF (Andhra Pradesh Working Union Journalists Forum). Having worked as regional editor for Andhra Bhoomi, Vaartha, Leader, and Indian Express, he established the publication on core principles of accuracy and public trust, which we carry forward today using modern AI systems.
            </p>
          </div>

          {/* Moderator Call-to-action */}
          <div className="space-y-3">
            <h4 className="text-xs uppercase tracking-wider font-bold text-foreground">Join Our Community</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed font-light">
              Help us fight misinformation and maintain the highest standard of journalism. Apply to audit, annotate, and approve upcoming news reports.
            </p>
            <div>
              <a
                href="http://localhost:3002/register"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline transition-all"
              >
                want to be a News moderator? ↗
              </a>
            </div>
          </div>

          {/* Quick Links */}
          <div className="space-y-3 md:text-right md:flex md:flex-col md:justify-between md:items-end">
            <div className="flex flex-col gap-2 text-xs text-muted-foreground font-medium md:items-end">
              <h4 className="text-xs uppercase tracking-wider font-bold text-foreground mb-1">Navigation</h4>
              <Link href="/" className="hover:text-primary transition-colors">Home</Link>
              <Link href="#" className="hover:text-primary transition-colors">Terms of Use</Link>
              <Link href="#" className="hover:text-primary transition-colors">Privacy Policy</Link>
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-4 md:mt-0">
              &copy; {new Date().getFullYear()} Naveen Publications. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Paywall & Login Modal */}
      {showPaywall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadein">
          <div className="bg-card text-card-foreground rounded-2xl p-6 max-w-md w-full border border-border shadow-2xl animate-scalein">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
                Unlock Premium Content
              </h2>
              <button
                onClick={() => setShowPaywall(false)}
                className="p-1 rounded-lg border border-border hover:bg-muted text-muted-foreground"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              Read breaking AI-curated news articles, submit comments, express your opinion, and participate in discussions. Login or subscribe now!
            </p>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.target as any;
                const email = form.email.value;
                if (email) {
                  await login(email);
                  form.reset();
                  setShowPaywall(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold mb-1">Email Address</label>
                <input
                  type="email"
                  name="email"
                  placeholder="name@company.com"
                  required
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  className="flex-grow py-2 px-4 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-all"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={subscribe}
                  className="flex-grow py-2 px-4 rounded-lg bg-indigo-500 text-white text-sm font-semibold hover:bg-indigo-600 transition-all"
                >
                  Subscribe ($0/mo)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}
