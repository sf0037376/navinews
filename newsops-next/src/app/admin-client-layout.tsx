'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';

const AdminContext = createContext<{
  role: 'SystemAdmin' | 'Editor' | 'Moderator' | 'Author';
  setRole: (role: any) => void;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  orgConfig: { tenantName: string; subdomain: string; apiSecret: string };
  setOrgConfig: (cfg: any) => void;
  user: any;
  logout: () => void;
}>({
  role: 'SystemAdmin',
  setRole: () => {},
  darkMode: true,
  setDarkMode: () => {},
  orgConfig: { tenantName: 'NewsOps Cloud', subdomain: 'newsops', apiSecret: 'sk_live_newsops_secret_key_2026' },
  setOrgConfig: () => {},
  user: null,
  logout: () => {},
});

export const useAdmin = () => useContext(AdminContext);

export default function AdminClientLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<'SystemAdmin' | 'Editor' | 'Moderator' | 'Author'>('SystemAdmin');
  const [darkMode, setDarkMode] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [orgConfig, setOrgConfig] = useState({
    tenantName: 'NewsOps Cloud',
    subdomain: 'newsops',
    apiSecret: 'sk_live_newsops_secret_key_2026',
  });

  useEffect(() => {
    // 1. Theme Configuration load (light by default)
    const savedTheme = localStorage.getItem('admin_theme');
    if (savedTheme === 'dark') {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
    } else {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
    }

    // 2. Auth Configuration check
    const token = localStorage.getItem('admin_token');
    const savedUser = localStorage.getItem('admin_user');

    if (!token && pathname !== '/login') {
      router.push('/login');
    } else if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      // Map active role to user's title
      if (['SystemAdmin', 'Editor', 'Moderator', 'Author'].includes(u.title)) {
        setRole(u.title);
      }
    }
    setLoadingAuth(false);
  }, [pathname, router]);

  const toggleTheme = () => {
    if (darkMode) {
      setDarkMode(false);
      document.documentElement.classList.remove('dark');
      localStorage.setItem('admin_theme', 'light');
    } else {
      setDarkMode(true);
      document.documentElement.classList.add('dark');
      localStorage.setItem('admin_theme', 'dark');
    }
  };

  const logout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_user');
    setUser(null);
    router.push('/login');
  };

  const navItems = [
    { id: 'dashboard', label: 'Console Dashboard', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2H6a2 2 0 01-2-2v-4zM14 16a2 2 0 012-2h2a2 2 0 012 2v4a2 2 0 01-2 2h-2a2 2 0 01-2-2v-4z' },
    { id: 'ingestion', label: 'Ingestion Sources', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18.5M7 10a4 4 0 11-8 0 4 4 0 018 0z' },
    { id: 'editorial', label: 'Editorial Review', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
    { id: 'organizations', label: 'Organizations', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
    { id: 'settings', label: 'System Config', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  ];

  if (loadingAuth) {
    return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center text-xs">Authenticating workspace access...</div>;
  }

  // Bypass layout wrapper for login path
  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <AdminContext.Provider value={{ role, setRole, darkMode, setDarkMode: toggleTheme, orgConfig, setOrgConfig, user, logout }}>
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-64 glass border-r border-border flex flex-col justify-between p-4 hidden md:flex">
          <div className="space-y-6">
            <div className="flex items-center gap-3 px-2">
              <Image
                src="/logo.jpg"
                alt="NewsOps Business Logo"
                width={36}
                height={36}
                className="rounded-full shadow border border-primary"
              />
              <div>
                <h1 className="font-extrabold text-sm tracking-tight bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
                  NewsOps Console
                </h1>
                <p className="text-[10px] text-muted-foreground font-medium">Naveen Publications</p>
              </div>
            </div>

            {/* Simulated Role Quick Switcher */}
            <div className="p-3 bg-muted border border-border rounded-xl space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
                  Active User Role
                </span>
                <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded font-bold uppercase">
                  RBAC
                </span>
              </div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as any)}
                className="w-full text-xs font-semibold px-2 py-1.5 rounded-md bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              >
                <option value="SystemAdmin">SystemAdmin (All Access)</option>
                <option value="Editor">Editor (Publish Drafts)</option>
                <option value="Moderator">Moderator (Ingestion Sync)</option>
                <option value="Author">Author (Create Drafts Only)</option>
              </select>
            </div>

            {/* Sidebar Navigation Link Nodes */}
            <nav className="space-y-1">
              {navItems.map(item => (
                <Link
                  key={item.id}
                  href={item.id === 'dashboard' ? '/' : `/${item.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-xs font-semibold hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                  </svg>
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="space-y-4 pt-4 border-t border-border/60">
            {user && (
              <div className="p-2 border border-border/40 rounded-lg flex items-center justify-between text-xs bg-muted/40">
                <div className="truncate pr-2">
                  <p className="font-bold truncate text-[11px]">{user.firstName} {user.lastName}</p>
                  <p className="text-[9px] text-muted-foreground">{user.email}</p>
                </div>
                <button
                  onClick={logout}
                  className="text-[10px] px-2 py-1 rounded bg-destructive text-white hover:bg-destructive/90 font-bold transition-all"
                >
                  Exit
                </button>
              </div>
            )}

            <button
              onClick={toggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 border border-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <span>{darkMode ? 'Light Theme' : 'Dark Theme'}</span>
              <span>{darkMode ? '☀️' : '🌙'}</span>
            </button>

            <div className="text-[10px] text-muted-foreground px-2 font-medium">
              Version 1.1.0 (Phase 1 Expansion)
            </div>
          </div>
        </aside>

        {/* Content Panel */}
        <main className="flex-grow p-6 md:p-8 overflow-y-auto">
          {/* Header Dashboard Info (Mobile version) */}
          <div className="flex md:hidden items-center justify-between pb-6 border-b border-border mb-6">
            <div className="flex items-center gap-2">
              <Image src="/logo.jpg" alt="Logo" width={32} height={32} className="rounded-full" />
              <span className="font-extrabold text-sm text-primary">NewsOps Console</span>
            </div>
            {user && (
              <button
                onClick={logout}
                className="text-[10px] px-2.5 py-1 rounded bg-destructive text-white font-bold"
              >
                Logout
              </button>
            )}
          </div>

          <div className="animate-slideup">
            {children}
          </div>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
