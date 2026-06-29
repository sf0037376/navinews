'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAdmin } from '../../../admin-client-layout';

export default function ArticleEditorPage() {
  const router = useRouter();
  const { id } = useParams() as { id: string };
  const { role } = useAdmin();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const editorRef = useRef<HTMLDivElement>(null);

  const [uploadingImage, setUploadingImage] = useState(false);
  const [processingPuter, setProcessingPuter] = useState(false);
  const [generatingThumb, setGeneratingThumb] = useState(false);

  const [aiVeracityStatus, setAiVeracityStatus] = useState('UNVERIFIED');
  const [aiExplanation, setAiExplanation] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showCatDropdown, setShowCatDropdown] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);

  const handleCategoryToggle = (catId: string) => {
    setSelectedCategoryIds(prev => {
      if (prev.includes(catId)) {
        if (status === 'PUBLISHED' && role !== 'SystemAdmin' && role !== 'Editor') {
          return prev;
        }
        return prev.filter(id => id !== catId);
      } else {
        if (status === 'PUBLISHED' && role !== 'SystemAdmin' && role !== 'Editor') {
          return prev;
        }
        return [...prev, catId];
      }
    });
  };

  // Load Puter SDK and Click Outside Listener
  useEffect(() => {
    if (typeof window !== 'undefined' && !document.getElementById('puter-sdk-script')) {
      const script = document.createElement('script');
      script.id = 'puter-sdk-script';
      script.src = 'https://js.puter.com/v2/';
      script.async = true;
      document.head.appendChild(script);
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (catDropdownRef.current && !catDropdownRef.current.contains(event.target as Node)) {
        setShowCatDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Fetch article details & categories list
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const token = localStorage.getItem('admin_token');
        const authHeaders: Record<string, string> = {};
        if (token) {
          authHeaders['Authorization'] = `Bearer ${token}`;
        }

        // Fetch categories list
        const catRes = await fetch('http://localhost:3001/api/v1/editorial/categories', {
          headers: authHeaders,
        });
        if (catRes.ok) {
          const catData = await catRes.json();
          setCategories(catData);
        }

        // Fetch article
        const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}`, {
          headers: authHeaders,
        });
        if (res.ok) {
          const data = await res.json();
          setTitle(data.title);
          setSummary(data.summary || '');
          setStatus(data.status);
          setCategoryId(data.categoryId || '');
          setAiVeracityStatus(data.aiVeracityStatus || 'UNVERIFIED');
          setAiExplanation(data.aiExplanation || '');
          if (data.articleCategories && data.articleCategories.length > 0) {
            setSelectedCategoryIds(data.articleCategories.map((ac: any) => ac.categoryId));
          } else {
            setSelectedCategoryIds(data.categoryId ? [data.categoryId] : []);
          }
          if (editorRef.current) {
            editorRef.current.innerHTML = data.content;
          }
        } else {
          throw new Error('Failed to load article');
        }
      } catch (err: any) {
        alert(`Error loading article: ${err.message}`);
        router.push('/editorial');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [id, router]);

  const execCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    
    setUploadingImage(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:3001/api/v1/editorial/media/upload', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      if (res.ok) {
        const data = await res.json();
        const url = data.imageUrl || `http://localhost:3001${data.url}`;
        execCmd('insertHTML', `<img src="${url}" alt="Uploaded image" class="my-4 rounded-xl max-w-full shadow border-2 border-primary/20 block" />`);
      } else {
        throw new Error('Upload error');
      }
    } catch {
      const localUrl = URL.createObjectURL(file);
      execCmd('insertHTML', `<img src="${localUrl}" alt="Local mockup image" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-indigo-400/20 block" />`);
    } finally {
      setUploadingImage(false);
    }
  };

  const parseAiRewriteResponse = (rawResult: string) => {
    let jsonStr = rawResult.trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.substring(7);
    else if (jsonStr.startsWith('```')) jsonStr = jsonStr.substring(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.substring(0, jsonStr.length - 3);
    
    try {
      return JSON.parse(jsonStr.trim());
    } catch {
      // Robust fallback to extract JSON object from surrounding text/ads
      const match = rawResult.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e) {
          console.warn('Failed to parse brace-matched JSON substring:', e);
        }
      }

      // Regex fallback
      const titleMatch = rawResult.match(/"title":\s*"(.*?)"/);
      const summaryMatch = rawResult.match(/"summary":\s*"(.*?)"/);
      const contentMatch = rawResult.match(/"content":\s*"(.*?)"/);
      return {
        title: titleMatch ? titleMatch[1] : '',
        summary: summaryMatch ? summaryMatch[1] : '',
        content: contentMatch ? contentMatch[1] : rawResult,
      };
    }
  };



  const handlePuterAiAction = async (action: 'rewrite' | 'translate', langName: string = 'en') => {
    const puter = (window as any).puter;
    if (!puter) {
      alert('AI SDK is currently loading. Please retry in a few seconds.');
      return;
    }

    const currentText = editorRef.current?.innerText || '';
    if (!currentText || currentText.trim().length < 20) {
      alert('The article body text is empty or too short to process with AI.');
      return;
    }

    setProcessingPuter(true);
    try {
      let prompt = '';
      if (action === 'rewrite') {
        prompt = `You are a professional journalist. Rewrite and format the following news content.
Generate a new professional headline title, an engaging sub-heading (SEO summary), and a cleanly rewritten body content formatted with HTML paragraph (<p>) tags.
Return your response STRICTLY in raw JSON format with keys: "title", "summary", and "content".
Do not wrap the JSON output in markdown tags or add extra notes.
Content:
${currentText}`;
      } else {
        prompt = `You are a professional translator. Translate the following news content into fluent, natural ${langName}. Preserve all HTML paragraph tags exactly. Return ONLY the translated output (do not wrap in markdown or add extra notes):\n\n${currentText}`;
      }

      // Priority 1 & 2: Call backend API (attempts Pollinations then NVIDIA NIM)
      let resultText = '';
      const token = localStorage.getItem('admin_token');
      try {
        const res = await fetch('http://localhost:3001/api/v1/editorial/articles/ai-fallback', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ prompt }),
        });
        if (!res.ok) {
          throw new Error('Backend AI fallback returned non-ok status.');
        }
        const data = await res.json();
        resultText = data.result;
      } catch (backendErr) {
        console.warn('Backend AI execution (Pollinations & NVIDIA) failed or returned error. Falling back to Puter.js on the client...', backendErr);
        
        // Priority 3: Puter.js client-side fallback
        const response = await puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
        resultText = response?.message?.content || response?.toString() || '';
      }

      if (resultText) {
        if (action === 'rewrite') {
          const parsed = parseAiRewriteResponse(resultText);
          if (parsed.title) setTitle(parsed.title);
          if (parsed.summary) setSummary(parsed.summary);
          if (parsed.content && editorRef.current) {
            const sourceRefMatch = editorRef.current.innerHTML.match(/Source Reference:.*<\/a>/i);
            let contentHtml = parsed.content.trim();
            if (sourceRefMatch) {
              contentHtml += `\n<p className="mt-8 pt-4 border-t border-border text-[10px] text-muted-foreground font-mono">${sourceRefMatch[0]}</p>`;
            }
            editorRef.current.innerHTML = contentHtml;
          }
        } else {
          if (editorRef.current) {
            const sourceRefMatch = editorRef.current.innerHTML.match(/Source Reference:.*<\/a>/i);
            let contentHtml = resultText.trim();
            if (sourceRefMatch) {
              contentHtml += `\n<p className="mt-8 pt-4 border-t border-border text-[10px] text-muted-foreground font-mono">${sourceRefMatch[0]}</p>`;
            }
            editorRef.current.innerHTML = contentHtml;
          }
        }
      } else {
        alert('All AI generation services (Pollinations, NVIDIA, and Puter.js) returned empty responses.');
      }
    } catch (err: any) {
      alert(`AI execution failed across all fallbacks: ${err.message || err}`);
    } finally {
      setProcessingPuter(false);
    }
  };

  const handleGenerateThumbnailSeparately = async () => {
    const textContent = editorRef.current?.innerText || '';
    if (!textContent || textContent.trim().length < 10) {
      alert('Please make sure there is text content in the editor to base the thumbnail prompt on.');
      return;
    }

    setGeneratingThumb(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:3001/api/v1/editorial/articles/generate-ai-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          summary: textContent.substring(0, 200),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const encodedPrompt = encodeURIComponent(data.thumbnailPrompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`;
        const imageHtml = `<img src="${imageUrl}" alt="${data.thumbnailAlt}" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block animate-fadein" />`;
        
        if (editorRef.current) {
          editorRef.current.innerHTML = imageHtml + editorRef.current.innerHTML;
        }
      } else {
        throw new Error('Backend prompt generation failed.');
      }
    } catch (err: any) {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent('photojournalism style cover matching: ' + title)}?width=800&height=450&nologo=true`;
      const imageHtml = `<img src="${imageUrl}" alt="AI generated thumbnail" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block" />`;
      if (editorRef.current) {
        editorRef.current.innerHTML = imageHtml + editorRef.current.innerHTML;
      }
    } finally {
      setGeneratingThumb(false);
    }
  };

  const handleSaveArticle = async () => {
    if (selectedCategoryIds.length === 0) {
      alert('Error: Please select at least one content category.');
      return;
    }

    setSaving(true);
    const htmlContent = editorRef.current?.innerHTML || '';

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          summary,
          content: htmlContent,
          categoryIds: selectedCategoryIds,
        }),
      });

      if (res.ok) {
        alert('Article draft saved successfully!');
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Save failed');
      }
    } catch (err: any) {
      alert(`Error saving changes: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const autoSaveBeforeStatus = async (token: string | null) => {
    if (selectedCategoryIds.length === 0) {
      throw new Error('Category selection is required before submitting/publishing.');
    }
    const htmlContent = editorRef.current?.innerHTML || '';
    const saveRes = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        title,
        summary,
        content: htmlContent,
        categoryIds: selectedCategoryIds,
      }),
    });
    if (!saveRes.ok) {
      const errData = await saveRes.json().catch(() => ({}));
      throw new Error(errData.message || 'Auto-save failed.');
    }
  };

  const handleSubmitForReview = async () => {
    setSubmitting(true);
    try {
      const token = localStorage.getItem('admin_token');
      // Auto-save changes first to prevent stale database state errors
      await autoSaveBeforeStatus(token);

      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'IN_REVIEW' }),
      });
      if (res.ok) {
        setStatus('IN_REVIEW');
        alert('Article submitted for editorial approval review!');
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Submit failed');
      }
    } catch (err: any) {
      alert(`Error submitting: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePublish = async () => {
    if (role !== 'SystemAdmin' && role !== 'Editor') {
      alert('Forbidden: Authors require Editorial approval to publish articles directly.');
      return;
    }

    // Rule: only verified ones can be published by editor, admin can publish any article irrespective of status
    if (role === 'Editor' && aiVeracityStatus !== 'VERIFIED') {
      alert('Forbidden: Editors can only publish articles that have been verified by AI.');
      return;
    }

    setPublishing(true);
    try {
      const token = localStorage.getItem('admin_token');
      // Auto-save changes first to prevent stale database state errors
      await autoSaveBeforeStatus(token);

      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'PUBLISHED' }),
      });
      if (res.ok) {
        setStatus('PUBLISHED');
        alert('Article has been successfully approved and published live!');
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Publish failed');
      }
    } catch (err: any) {
      alert(`Error publishing: ${err.message}`);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm('Are you sure you want to unpublish this article? It will be reverted to draft.')) {
      return;
    }
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      if (res.ok) {
        setStatus('DRAFT');
        alert('Article unpublished successfully and reverted to Draft.');
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Action failed');
      }
    } catch (err: any) {
      alert(`Error unpublishing: ${err.message}`);
    }
  };

  const handleReject = async () => {
    if (!confirm('Are you sure you want to reject this In-Review article? It will be reverted to draft.')) {
      return;
    }
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'DRAFT' }),
      });
      if (res.ok) {
        setStatus('DRAFT');
        alert('Article rejected and reverted to Draft.');
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Action failed');
      }
    } catch (err: any) {
      alert(`Error rejecting: ${err.message}`);
    }
  };

  const handleDeleteDraft = async () => {
    if (!confirm('Are you sure you want to delete this Draft article? This action cannot be undone.')) {
      return;
    }
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}`, {
        method: 'DELETE',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      });
      if (res.ok) {
        alert('Draft article deleted successfully.');
        router.push('/editorial');
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'Action failed');
      }
    } catch (err: any) {
      alert(`Error deleting article: ${err.message}`);
    }
  };

  const handleVerifyAuthenticity = async () => {
    setVerifying(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}/verify-authenticity`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
      });

      if (res.ok) {
        const data = await res.json();
        setAiVeracityStatus(data.aiVeracityStatus);
        setAiExplanation(data.aiExplanation || '');
        alert(`AI Authenticity check completed! Status: ${data.aiVeracityStatus}`);
      } else {
        throw new Error('Verification request failed.');
      }
    } catch (err: any) {
      alert(`Error running authenticity check: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <span className="text-xs text-muted-foreground font-light">Loading rich document content...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12 animate-slideup">
      {/* Header and Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/40 pb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/editorial')}
            className="p-2 rounded-lg bg-card hover:bg-muted border border-border text-foreground transition-all cursor-pointer text-xs flex items-center gap-1"
          >
            ← Back
          </button>
          <div>
            <h2 className="text-lg font-bold tracking-tight">Editorial Article Canvas</h2>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                status === 'PUBLISHED' ? 'bg-teal-500/10 text-teal-500 border-teal-500/20' :
                status === 'IN_REVIEW' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' :
                'bg-slate-500/10 text-slate-400 border-slate-500/20'
              }`}>
                {status}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border flex items-center gap-1 ${
                aiVeracityStatus === 'VERIFIED' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                aiVeracityStatus === 'REFUTED' ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                'bg-amber-500/10 text-amber-500 border-amber-500/20'
              }`} title={aiExplanation || 'No AI explanation generated yet.'}>
                🛡️ AI Veracity: {aiVeracityStatus}
              </span>
              <span className="text-[10px] text-muted-foreground font-light">Document ID: {id.slice(0, 8)}...</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleVerifyAuthenticity}
            disabled={verifying}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition-all disabled:opacity-50 cursor-pointer shadow-sm flex items-center gap-1"
          >
            {verifying ? (
              <>
                <svg className="animate-spin h-3 w-3 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Verifying...
              </>
            ) : (
              '🔍 Verify Authenticity'
            )}
          </button>

          <button
            onClick={handleSaveArticle}
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-all disabled:opacity-50 cursor-pointer shadow-sm"
          >
            {saving ? 'Saving...' : 'Save Draft'}
          </button>

          {status === 'DRAFT' && (role === 'Author' || role === 'SystemAdmin') && (
            <>
              <button
                onClick={handleSubmitForReview}
                disabled={submitting}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-all disabled:opacity-50 cursor-pointer shadow"
              >
                {submitting ? 'Submitting...' : 'Submit Approval'}
              </button>
              <button
                onClick={handleDeleteDraft}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-all cursor-pointer shadow"
              >
                🗑️ Delete Draft
              </button>
            </>
          )}

          {status === 'IN_REVIEW' && (role === 'Editor' || role === 'SystemAdmin') && (
            <>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-white hover:bg-primary/95 transition-all disabled:opacity-50 cursor-pointer shadow"
              >
                {publishing ? 'Publishing...' : 'Approve & Publish'}
              </button>
              <button
                onClick={handleReject}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-all cursor-pointer shadow"
              >
                🚫 Reject
              </button>
            </>
          )}

          {status === 'PUBLISHED' && (role === 'Editor' || role === 'SystemAdmin') && (
            <button
              onClick={handleUnpublish}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-600 text-white hover:bg-slate-700 transition-all cursor-pointer shadow"
            >
              ⏸️ Unpublish
            </button>
          )}
        </div>
      </div>

      {/* Editor Layout splits */}
      <div className="grid grid-cols-1 gap-6">
        {/* Title, sub-heading, and Category select option */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Headline Title</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Article heading..."
              className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Sub-heading (SEO summary)</label>
            <input
              type="text"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              placeholder="Article brief snippet..."
              className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none transition-colors"
            />
          </div>
          <div className="relative" ref={catDropdownRef}>
            <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Content Categories</label>
            <button
              type="button"
              disabled={status === 'PUBLISHED' && role !== 'SystemAdmin' && role !== 'Editor'}
              onClick={() => setShowCatDropdown(prev => !prev)}
              className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none transition-colors text-left flex items-center justify-between disabled:opacity-60 disabled:cursor-not-allowed select-none min-h-[34px]"
            >
              <span className="truncate pr-2">
                {selectedCategoryIds.length === 0
                  ? 'Select Categories...'
                  : selectedCategoryIds
                      .map(id => categories.find(c => c.id === id)?.name)
                      .filter(Boolean)
                      .join(', ')}
              </span>
              <span className="text-[9px] text-muted-foreground select-none">▼</span>
            </button>

            {showCatDropdown && (
              <div className="absolute z-50 left-0 right-0 mt-1 p-2 bg-slate-900 border border-border rounded-xl shadow-xl max-h-60 overflow-y-auto space-y-1">
                {categories.map((cat: any) => {
                  const isSelected = selectedCategoryIds.includes(cat.id);
                  return (
                    <label
                      key={cat.id}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs cursor-pointer transition-all hover:bg-muted select-none ${
                        isSelected ? 'bg-primary/10 text-primary font-semibold' : 'text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleCategoryToggle(cat.id)}
                        className="rounded border-border text-primary focus:ring-primary w-3.5 h-3.5"
                      />
                      <span>{cat.name}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* AI Veracity Explanation Box */}
        {aiExplanation && (
          <div className={`p-4 rounded-xl border flex gap-3 text-xs leading-relaxed animate-fadein ${
            aiVeracityStatus === 'VERIFIED' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' :
            aiVeracityStatus === 'REFUTED' ? 'bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-400' :
            'bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400'
          }`}>
            <span className="text-base select-none">
              {aiVeracityStatus === 'VERIFIED' ? '🛡️' : aiVeracityStatus === 'REFUTED' ? '🚫' : '⚠️'}
            </span>
            <div>
              <p className="font-bold mb-0.5">AI Authenticity Fact-Check Explanation:</p>
              <p className="font-light opacity-90">{aiExplanation}</p>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-950 border border-border rounded-xl shadow-inner">
          <button type="button" onClick={() => execCmd('bold')} className="p-1.5 rounded hover:bg-muted text-xs font-bold w-8 text-slate-300" title="Bold">B</button>
          <button type="button" onClick={() => execCmd('italic')} className="p-1.5 rounded hover:bg-muted text-xs italic w-8 text-slate-300" title="Italic">I</button>
          <button type="button" onClick={() => execCmd('underline')} className="p-1.5 rounded hover:bg-muted text-xs underline w-8 text-slate-300" title="Underline">U</button>
          
          <div className="w-px h-5 bg-border mx-1" />
          
          <button type="button" onClick={() => execCmd('formatBlock', '<h1>')} className="p-1.5 rounded hover:bg-muted text-xs w-10 font-black text-slate-300" title="Heading 1">H1</button>
          <button type="button" onClick={() => execCmd('formatBlock', '<h2>')} className="p-1.5 rounded hover:bg-muted text-xs w-10 font-extrabold text-slate-300" title="Heading 2">H2</button>
          <button type="button" onClick={() => execCmd('formatBlock', '<blockquote>')} className="p-1.5 rounded hover:bg-muted text-xs w-14 font-serif text-slate-300" title="Blockquote">Quote</button>
          
          <div className="w-px h-5 bg-border mx-1" />
          
          <button type="button" onClick={() => execCmd('insertUnorderedList')} className="p-1.5 rounded hover:bg-muted text-xs w-12 font-medium text-slate-300" title="Bullet List">• List</button>
          <button type="button" onClick={() => execCmd('insertOrderedList')} className="p-1.5 rounded hover:bg-muted text-xs w-12 font-medium text-slate-300" title="Numbered List">1. List</button>
          
          <div className="w-px h-5 bg-border mx-1" />

          {/* Local image uploader button */}
          <label className="flex items-center gap-1 px-3 py-1 bg-primary/20 hover:bg-primary/30 border border-primary/30 rounded-lg text-xs font-semibold cursor-pointer text-primary">
            <input
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            {uploadingImage ? 'Uploading...' : 'Insert Image'}
          </label>

          <div className="w-px h-5 bg-border mx-1" />

          {/* AI Generate / Rewrite */}
          <button
            type="button"
            onClick={() => handlePuterAiAction('rewrite')}
            disabled={processingPuter}
            className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-[10px] font-bold cursor-pointer text-purple-400 disabled:opacity-50"
            title="Clean up and professionally rewrite the news content using AI"
          >
            {processingPuter ? 'Processing...' : '🪄 AI Rewrite'}
          </button>

          {/* AI Translation actions */}
          <button
            type="button"
            onClick={() => handlePuterAiAction('translate', 'Hindi')}
            disabled={processingPuter}
            className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg text-[10px] font-bold cursor-pointer text-purple-300 disabled:opacity-50"
            title="Translate body to Hindi using AI"
          >
            🌐 Hindi
          </button>
          <button
            type="button"
            onClick={() => handlePuterAiAction('translate', 'Telugu')}
            disabled={processingPuter}
            className="flex items-center gap-1 px-2.5 py-1 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg text-[10px] font-bold cursor-pointer text-purple-300 disabled:opacity-50"
            title="Translate body to Telugu using AI"
          >
            🌐 Telugu
          </button>

          <div className="w-px h-5 bg-border mx-1" />

          {/* AI Thumbnail Generator */}
          <button
            type="button"
            onClick={handleGenerateThumbnailSeparately}
            disabled={generatingThumb}
            className="flex items-center gap-1 px-2.5 py-1 bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/30 rounded-lg text-[10px] font-bold cursor-pointer text-teal-400 disabled:opacity-50"
            title="Generate a custom photojournalism thumbnail image based on current article text"
          >
            {generatingThumb ? 'Creating Image...' : '🎨 Generate Thumbnail'}
          </button>
        </div>

        {/* Editable Area */}
        <div className="space-y-1">
          <label className="block text-[10px] uppercase font-bold text-muted-foreground">Article Body Content</label>
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="w-full min-h-[50vh] overflow-y-auto px-6 py-5 rounded-2xl bg-slate-950 border border-border focus:outline-none text-sm leading-relaxed text-slate-200 prose prose-invert font-light"
          />
        </div>
      </div>
    </div>
  );
}
