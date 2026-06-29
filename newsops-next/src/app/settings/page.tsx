'use client';
import { API_BASE_URL } from '@/lib/api';

import React, { useState, useEffect } from 'react';
import { useAdmin } from '../admin-client-layout';

export default function Settings() {
  const { orgConfig, setOrgConfig } = useAdmin();
  const [apiKey, setApiKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [activeProvider, setActiveProvider] = useState('Mock/Local Sandbox Fallback');
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    // Read from environment if set, or local storage simulate
    const savedKey = localStorage.getItem('newsops_gemini_key') || '';
    const savedOllama = localStorage.getItem('newsops_ollama_url') || 'http://localhost:11434';
    const savedSlack = localStorage.getItem('newsops_slack_webhook') || '';
    
    setApiKey(savedKey);
    setOllamaUrl(savedOllama);
    setSlackWebhookUrl(savedSlack);

    if (savedKey) {
      setActiveProvider('Google Gemini Pro / Flash');
    } else {
      setActiveProvider('Mock/Local Sandbox Fallback (Zero-Cost MVP Mode)');
    }

    try {
      // Try to fetch organization settings from DB if token is present
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`${API_BASE_URL}/api/v1/organizations`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const orgs = await res.json();
        if (orgs.length > 0 && orgs[0].slackWebhookUrl) {
          setSlackWebhookUrl(orgs[0].slackWebhookUrl);
        }
      }
    } catch {
      // Keep local fallbacks
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      localStorage.setItem('newsops_gemini_key', apiKey);
      localStorage.setItem('newsops_ollama_url', ollamaUrl);
      localStorage.setItem('newsops_slack_webhook', slackWebhookUrl);

      // Call organizations update on backend if logged in
      const token = localStorage.getItem('admin_token');
      const orgRes = await fetch(`${API_BASE_URL}/api/v1/organizations`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (orgRes.ok) {
        const orgs = await orgRes.json();
        if (orgs.length > 0) {
          // Update slackWebhookUrl for first organization
          await fetch(`${API_BASE_URL}/api/v1/organizations/${orgs[0].id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              slackWebhookUrl,
            }),
          });
        }
      }
    } catch {
      // Safe offline bypass
    }

    setTimeout(() => {
      if (apiKey) {
        setActiveProvider('Google Gemini Pro / Flash');
      } else {
        setActiveProvider('Mock/Local Sandbox Fallback (Zero-Cost MVP Mode)');
      }
      setSaving(false);
      alert('System parameters saved successfully! Discord/Slack integration routing updated.');
    }, 800);
  };

  return (
    <div className="space-y-6 max-w-3xl animate-slideup">
      <div>
        <h2 className="text-xl font-bold border-l-4 border-primary pl-3 tracking-tight">System configuration</h2>
        <p className="text-xs text-muted-foreground mt-1">Configure credentials, secrets, and pluggable AI providers</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 glass p-6 rounded-2xl border border-border shadow-sm space-y-6">
          <form onSubmit={handleSaveSettings} className="space-y-6">
            <div>
              <h3 className="font-bold text-sm mb-3">Pluggable AI Provider Credentials</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">Google Gemini API Key (BYO-AI)</label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1 text-muted-foreground">Local Ollama Model URL</label>
                  <input
                    type="url"
                    value={ollamaUrl}
                    onChange={e => setOllamaUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="border-t border-border pt-4">
              <h3 className="font-bold text-sm mb-3">System Integrations & Webhooks</h3>
              <div>
                <label className="block text-xs font-semibold mb-1 text-muted-foreground">Slack Incoming Webhook URL</label>
                <input
                  type="url"
                  value={slackWebhookUrl}
                  onChange={e => setSlackWebhookUrl(e.target.value)}
                  placeholder="https://hooks.slack.com/services/YOUR/WEBHOOK/HERE"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none font-mono"
                />
                <p className="text-[10px] text-muted-foreground mt-1 font-light leading-relaxed">
                  Automatically notifies your Slack channel on feed crawler ingestion events, moderator review pipelines, and editorial publish decisions.
                </p>
              </div>
            </div>

            <div className="pt-2 text-right">
              <button
                type="submit"
                disabled={saving}
                className="text-xs font-semibold px-4 py-2 bg-primary hover:bg-primary/95 text-white rounded-lg transition-all shadow cursor-pointer"
              >
                {saving ? 'Saving...' : 'Save Parameters'}
              </button>
            </div>
          </form>
        </div>

        {/* Info panel */}
        <div className="glass p-5 rounded-2xl border border-border space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-l-2 border-primary pl-2">
              Resolved Provider
            </h4>

            <div className="p-3 bg-muted border border-border rounded-xl">
              <span className="text-[10px] text-muted-foreground font-semibold block mb-1">Active Backend Router:</span>
              <span className="text-xs font-extrabold text-primary leading-snug">{activeProvider}</span>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground font-light leading-relaxed">
            <strong>Pluggable Abstraction:</strong> The NewsOps AI engine evaluates environment flags sequentially. If a custom Gemini Key is supplied, the system routes generation APIs to Google; else it targets Ollama; else it defaults to the offline mock generator.
          </p>
        </div>
      </div>
    </div>
  );
}
