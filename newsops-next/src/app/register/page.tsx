'use client';
import { API_BASE_URL } from '@/lib/api';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

export default function ModeratorRegistration() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [aadhaarNo, setAadhaarNo] = useState('');
  const [roleName, setRoleName] = useState('ContentModerator');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const savedTheme = localStorage.getItem('admin_theme');
    if (savedTheme === 'dark') {
      setThemeMode('dark');
    } else {
      setThemeMode('light');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          phone,
          address,
          aadhaarNo,
          roleName,
        }),
      });

      if (res.ok) {
        setSuccess('Registration successful! Redirecting to login...');
        setTimeout(() => {
          router.push('/login');
        }, 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Registration failed.');
      }
    } catch (err: any) {
      setError(err.message || 'Error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  const isDark = themeMode === 'dark';

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-300 ${
      isDark ? 'bg-slate-950 text-white' : 'bg-gradient-to-tr from-slate-50 via-slate-100 to-indigo-50/40 text-slate-900'
    }`}>
      <div className={`p-8 rounded-2xl border shadow-2xl max-w-xl w-full space-y-6 transition-colors duration-300 ${
        isDark 
          ? 'bg-slate-900/60 border-border text-slate-100 backdrop-blur-md' 
          : 'bg-white border-slate-200/80 text-slate-800 shadow-slate-200/50'
      }`}>
        <div className="flex flex-col items-center gap-3 text-center">
          <Image
            src="/logo.jpg"
            alt="NewsOps Logo"
            width={48}
            height={48}
            className="rounded-full shadow-md border-2 border-primary"
          />
          <h2 className="font-extrabold text-2xl tracking-tight bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">
            Moderator & Author Registration
          </h2>
          <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500 font-medium'}`}>
            Register credentials with official authenticity details to apply as a News reviewer
          </p>
        </div>

        {error && (
          <div className={`p-3 rounded-lg border text-xs font-semibold text-center ${
            isDark 
              ? 'bg-rose-500/15 border-rose-500/20 text-rose-400' 
              : 'bg-rose-50 border-rose-200 text-rose-600'
          }`}>
            {error}
          </div>
        )}

        {success && (
          <div className={`p-3 rounded-lg border text-xs font-semibold text-center ${
            isDark 
              ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-400' 
              : 'bg-emerald-50 border-emerald-200 text-emerald-600'
          }`}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                First Name
              </label>
              <input
                type="text"
                required
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Naveen"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                  isDark 
                    ? 'bg-slate-950 border-border text-white' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
                }`}
              />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Last Name
              </label>
              <input
                type="text"
                required
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Publications"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                  isDark 
                    ? 'bg-slate-950 border-border text-white' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@newsops.cloud"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                  isDark 
                    ? 'bg-slate-950 border-border text-white' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
                }`}
              />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Access Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                  isDark 
                    ? 'bg-slate-950 border-border text-white' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Phone Number
              </label>
              <input
                type="tel"
                required
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+91 XXXXX XXXXX"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                  isDark 
                    ? 'bg-slate-950 border-border text-white' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
                }`}
              />
            </div>
            <div>
              <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Aadhaar No / Govt ID Number
              </label>
              <input
                type="text"
                required
                value={aadhaarNo}
                onChange={e => setAadhaarNo(e.target.value)}
                placeholder="12-digit Aadhaar or passport ID"
                className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                  isDark 
                    ? 'bg-slate-950 border-border text-white' 
                    : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
                }`}
              />
            </div>
          </div>

          <div>
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}>
              Desired Workspace Role
            </label>
            <select
              value={roleName}
              onChange={e => setRoleName(e.target.value)}
              className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                isDark 
                  ? 'bg-slate-950 border-border text-slate-300' 
                  : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
              }`}
            >
              <option value="ContentModerator">Content Moderator (Review Ingestion & Fact-checks)</option>
              <option value="Author">Staff Author (Write and Draft Articles)</option>
            </select>
          </div>

          <div>
            <label className={`block text-[10px] font-bold uppercase tracking-wider mb-1 ${
              isDark ? 'text-slate-400' : 'text-slate-500'
            }`}>
              Residential Address
            </label>
            <textarea
              required
              rows={3}
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Enter full permanent postal address..."
              className={`w-full px-3 py-2 text-xs rounded-lg border focus:ring-1 focus:ring-primary focus:outline-none transition-colors ${
                isDark 
                  ? 'bg-slate-950 border-border text-white' 
                  : 'bg-slate-50 border-slate-200 text-slate-900 focus:bg-white'
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-primary text-white rounded-lg text-xs font-bold hover:bg-primary/95 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed select-none"
          >
            {loading ? 'Submitting Verifications...' : 'Apply & Register as Moderator'}
          </button>
        </form>

        <div className="border-t border-border pt-4 text-center">
          <p className="text-[11px] text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="text-primary font-semibold hover:underline">
              Log in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
