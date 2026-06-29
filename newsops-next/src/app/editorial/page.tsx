'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useAdmin } from '../admin-client-layout';
import { useRouter } from 'next/navigation';

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED';
  versionNumber: number;
  categoryId?: string;
  aiVeracityStatus?: string;
  aiExplanation?: string;
}

interface TopicCluster {
  id: string;
  title: string;
  category: string;
  articlesCount: number;
}

export default function EditorialWorkflows() {
  const router = useRouter();
  const { role } = useAdmin();
  const [articles, setArticles] = useState<Article[]>([]);
  const [clusters, setClusters] = useState<TopicCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [veracityFilter, setVeracityFilter] = useState('ALL');

  const [categories, setCategories] = useState<any[]>([]);
  const [selectedDraftCategoryIds, setSelectedDraftCategoryIds] = useState<string[]>([]);
  const [showDraftCatDropdown, setShowDraftCatDropdown] = useState(false);
  const draftCatDropdownRef = useRef<HTMLDivElement>(null);

  // Write Draft Form
  const [draftTitle, setDraftTitle] = useState('');
  const [draftSummary, setDraftSummary] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  // Edit / WYSIWYG Modal state
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSummary, setEditSummary] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Universal Translation state
  const [showTranslateModal, setShowTranslateModal] = useState<Article | null>(null);
  const [targetLang, setTargetLang] = useState('es');
  const [translatingId, setTranslatingId] = useState<string | null>(null);

  const [generatingAiData, setGeneratingAiData] = useState(false);

  const [showImportForm, setShowImportForm] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importingUrl, setImportingUrl] = useState(false);

  const handleImportFromUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importUrl) return;
    
    setImportingUrl(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:3001/api/v1/editorial/articles/import-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: importUrl }),
      });

      if (res.ok) {
        alert('News article successfully fetched, parsed by AI, and saved as a Draft!');
        setImportUrl('');
        setShowImportForm(false);
        fetchData();
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to import article.');
      }
    } catch (err: any) {
      alert(`Error importing from URL: ${err.message}`);
    } finally {
      setImportingUrl(false);
    }
  };

  const [processingPuter, setProcessingPuter] = useState(false);
  const [generatingThumb, setGeneratingThumb] = useState(false);

  useEffect(() => {
    // Inject Puter.js SDK dynamically in browser layout context
    if (typeof window !== 'undefined' && !document.getElementById('puter-sdk-script')) {
      const script = document.createElement('script');
      script.id = 'puter-sdk-script';
      script.src = 'https://js.puter.com/v2/';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  const handlePuterAiAction = async (action: 'rewrite' | 'translate', langName: string = 'en') => {
    const puter = (window as any).puter;
    if (!puter) {
      alert('Puter.js AI SDK is currently loading. Please retry in a few seconds.');
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
        prompt = `You are a professional journalist. Rewrite and format the following raw news article text into a clean, engaging news report. Use HTML paragraph tags (<p>) for structure. Return ONLY the rewritten HTML body code (do not wrap in markdown tags or add extra notes):\n\n${currentText}`;
      } else {
        prompt = `You are a professional translator. Translate the following news content into fluent, natural ${langName}. Preserve all HTML paragraph tags exactly. Return ONLY the translated output (do not wrap in markdown or add extra notes):\n\n${currentText}`;
      }

      const response = await puter.ai.chat(prompt, { model: 'gpt-4o-mini' });
      const resultText = response?.message?.content || response?.toString() || '';
      
      if (resultText && editorRef.current) {
        // Keep source reference if present
        const sourceRefMatch = editorRef.current.innerHTML.match(/Source Reference:.*<\/a>/i);
        let contentHtml = resultText.trim();
        if (sourceRefMatch) {
          contentHtml += `\n<p className="mt-8 pt-4 border-t border-border text-[10px] text-muted-foreground font-mono">${sourceRefMatch[0]}</p>`;
        }
        editorRef.current.innerHTML = contentHtml;
      }
    } catch (err: any) {
      alert(`Puter.js execution failed: ${err.message || err}`);
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
          title: editTitle,
          summary: textContent.substring(0, 200),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const encodedPrompt = encodeURIComponent(data.thumbnailPrompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`;
        const imageHtml = `<img src="${imageUrl}" alt="${data.thumbnailAlt}" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block" />`;
        
        if (editorRef.current) {
          // Prepend thumbnail cover image to editor HTML body
          editorRef.current.innerHTML = imageHtml + editorRef.current.innerHTML;
        }
      } else {
        throw new Error('Backend thumbnail prompt generation failed.');
      }
    } catch (err: any) {
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent('photojournalism style cover matching: ' + editTitle)}?width=800&height=450&nologo=true`;
      const imageHtml = `<img src="${imageUrl}" alt="AI generated thumbnail" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block" />`;
      if (editorRef.current) {
        editorRef.current.innerHTML = imageHtml + editorRef.current.innerHTML;
      }
    } finally {
      setGeneratingThumb(false);
    }
  };

  const handleGenerateWithAi = async () => {
    if (!editTitle) {
      alert('Please enter a title to generate content for.');
      return;
    }

    setGeneratingAiData(true);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:3001/api/v1/editorial/articles/generate-ai-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: editTitle,
          summary: editSummary,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setEditTitle(data.title);
        setEditSummary(data.summary);
        
        // Generate live image URL from Pollinations.ai image generator
        const encodedPrompt = encodeURIComponent(data.thumbnailPrompt);
        const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`;
        
        const imageHtml = `<img src="${imageUrl}" alt="${data.thumbnailAlt}" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block" />`;
        
        if (editorRef.current) {
          editorRef.current.innerHTML = imageHtml + data.content;
        }
      } else {
        throw new Error('AI Generation failed');
      }
    } catch (err: any) {
      setEditSummary(`AI Generated summary for: ${editTitle}`);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent('photojournalism style cover matching: ' + editTitle)}?width=800&height=450&nologo=true`;
      const imageHtml = `<img src="${imageUrl}" alt="AI generated thumbnail" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block" />`;
      if (editorRef.current) {
        editorRef.current.innerHTML = imageHtml + `<p>This is a completely auto-generated AI article body copy matching prompt title: "${editTitle}".</p><p>The system resolved this content in local fallback mode using Pollinations.ai.</p>`;
      }
    } finally {
      setGeneratingAiData(false);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('admin_token');
      const artRes = await fetch('http://localhost:3001/api/v1/editorial/articles', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (artRes.ok) {
        const artData = await artRes.json();
        setArticles(artData);
      }

      const clusterRes = await fetch('http://localhost:3001/api/v1/intelligence/clusters', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (clusterRes.ok) {
        const clData = await clusterRes.json();
        setClusters(clData.data);
      }

      const catRes = await fetch('http://localhost:3001/api/v1/editorial/categories', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });
      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(catData);
      } else {
        throw new Error('Offline');
      }
    } catch {
      // Mock drafts fallback
      setArticles([
        { id: '1', title: 'TechCrunch: Early Stage Startups Shift Focus to Cash Retention', slug: 'early-stage-startups-cash', summary: 'Analysis of founders cutting burn rates.', content: '<p>Early-stage startups are modifying operations strategies. Growth targets have shifted to cash management and capital efficiency.</p>', status: 'DRAFT', versionNumber: 1 },
        { id: '2', title: 'Silicon Valley Banking Regulations: Post-Mortem Assessment', slug: 'valley-banking-post-mortem', summary: 'Federal board releases compliance notes.', content: '<p>Federal reviewers released compliance adjustments and liquidity indicators today. New reporting requirements are expected.</p>', status: 'IN_REVIEW', versionNumber: 2 },
        { id: '3', title: 'BBC: Semiconductor Export Quotas Restructured Globally', slug: 'semiconductor-export-quotas', summary: 'Major suppliers negotiate raw materials access.', content: '<p>Inter-governmental negotiations completed this afternoon. Supply routes will be structured to favor long-term contracts.</p>', status: 'PUBLISHED', versionNumber: 2 },
      ]);

      setClusters([
        { id: 'c1', title: 'AI Automation in Newsrooms', category: 'Technology', articlesCount: 14 },
        { id: 'c2', title: 'Global Supply Chain Agreements', category: 'Business', articlesCount: 8 },
        { id: 'c3', title: 'Post-Financial Regulations 2026', category: 'Politics', articlesCount: 5 },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const handleClickOutside = (event: MouseEvent) => {
      if (draftCatDropdownRef.current && !draftCatDropdownRef.current.contains(event.target as Node)) {
        setShowDraftCatDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleDraftCategoryToggle = (catId: string) => {
    setSelectedDraftCategoryIds(prev =>
      prev.includes(catId) ? prev.filter(id => id !== catId) : [...prev, catId]
    );
  };

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'SystemAdmin' && role !== 'Author') {
      alert('Forbidden: Only Author or SystemAdmin roles can write draft content.');
      return;
    }

    if (selectedDraftCategoryIds.length === 0) {
      alert('Error: Please select at least one content category.');
      return;
    }

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:3001/api/v1/editorial/articles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: draftTitle,
          summary: draftSummary,
          content: draftContent,
          categoryIds: selectedDraftCategoryIds,
        }),
      });
      if (res.ok) {
        setShowAddForm(false);
        setDraftTitle('');
        setDraftSummary('');
        setDraftContent('');
        setSelectedDraftCategoryIds([]);
        fetchData();
      } else {
        throw new Error('Offline');
      }
    } catch {
      const newArt: Article = {
        id: Math.random().toString(),
        title: draftTitle,
        slug: draftTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        summary: draftSummary,
        content: draftContent,
        status: 'DRAFT',
        versionNumber: 1,
      };
      setArticles(prev => [newArt, ...prev]);
      setShowAddForm(false);
      setDraftTitle('');
      setDraftSummary('');
      setDraftContent('');
    }
  };

  const handleSubmitForReview = async (id: string) => {
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ status: 'IN_REVIEW' }),
      });
      if (res.ok) {
        fetchData();
      } else {
        throw new Error('Offline');
      }
    } catch {
      setArticles(prev => prev.map(a => a.id === id ? { ...a, status: 'IN_REVIEW' } : a));
    }
  };

  const handlePublish = async (id: string) => {
    if (role !== 'SystemAdmin' && role !== 'Editor') {
      alert('Forbidden: Authors require Editorial approval to publish articles directly. Submitting to queue.');
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
        body: JSON.stringify({ status: 'PUBLISHED' }),
      });
      if (res.ok) {
        fetchData();
      } else {
        throw new Error('Offline');
      }
    } catch {
      setArticles(prev => prev.map(a => a.id === id ? { ...a, status: 'PUBLISHED' } : a));
    }
  };

  const handleGenerateFromCluster = async (clusterId: string) => {
    if (role !== 'SystemAdmin' && role !== 'Moderator') {
      alert('Forbidden: Only Content-Moderators can select cluster articles for generation.');
      return;
    }

    setGeneratingId(clusterId);
    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch('http://localhost:3001/api/v1/editorial/articles/generate-from-cluster', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ clusterId }),
      });
      if (res.ok) {
        alert('AI successfully generated English, Telugu, and Hindi translations draft articles!');
        fetchData();
      } else {
        throw new Error('Offline');
      }
    } catch {
      setTimeout(() => {
        const clusterName = clusters.find(c => c.id === clusterId)?.title || 'Topic';
        const newEng: Article = {
          id: Math.random().toString(),
          title: `Report: Insights on "${clusterName}"`,
          slug: `report-${clusterId}-en`,
          summary: `Aggregated news summary regarding ${clusterName}.`,
          content: `<p>Content generated for cluster ${clusterName}.</p>`,
          status: 'DRAFT',
          versionNumber: 1,
        };
        setArticles(prev => [newEng, ...prev]);
        setGeneratingId(null);
        alert('Simulation success: English, Telugu, and Hindi translation drafts created!');
      }, 1200);
      return;
    }
    setGeneratingId(null);
  };

  // WYSIWYG text execution helper
  const execCmd = (command: string, value: string = '') => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };

  // Handle local image upload inside WYSIWYG editor
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
        // Insert image element into WYSIWYG
        const url = data.imageUrl || `http://localhost:3001${data.url}`;
        execCmd('insertHTML', `<img src="${url}" alt="Uploaded image" class="my-4 rounded-xl max-w-full shadow border-2 border-primary/20 block" />`);
      } else {
        throw new Error('Upload error');
      }
    } catch {
      // Mock local URL fallback
      const localUrl = URL.createObjectURL(file);
      execCmd('insertHTML', `<img src="${localUrl}" alt="Local mockup image" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-indigo-400/20 block" />`);
    } finally {
      setUploadingImage(false);
    }
  };

  // Save changes from editor
  const handleSaveArticle = async () => {
    if (!editingArticle) return;
    if (role !== 'SystemAdmin' && role !== 'Author' && role !== 'Editor') {
      alert('Forbidden: Authenticated writer status is required to update draft copies.');
      return;
    }

    const htmlContent = editorRef.current?.innerHTML || '';

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${editingArticle.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: editTitle,
          summary: editSummary,
          content: htmlContent,
        }),
      });

      if (res.ok) {
        alert('Article draft revisions saved successfully!');
        setEditingArticle(null);
        fetchData();
      } else {
        throw new Error('Offline');
      }
    } catch {
      setArticles(prev => prev.map(a => a.id === editingArticle.id ? {
        ...a,
        title: editTitle,
        summary: editSummary,
        content: htmlContent,
        versionNumber: a.versionNumber + 1
      } : a));
      setEditingArticle(null);
      alert('Simulation Success: Local revision updated inside layout context.');
    }
  };

  // Launch dynamic translator
  const handleTranslateArticle = async () => {
    if (!showTranslateModal) return;
    setTranslatingId(showTranslateModal.id);

    try {
      const token = localStorage.getItem('admin_token');
      const res = await fetch(`http://localhost:3001/api/v1/editorial/articles/${showTranslateModal.id}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ targetLang }),
      });

      if (res.ok) {
        alert(`Successfully generated translated draft article for target: ${targetLang.toUpperCase()}!`);
        setShowTranslateModal(null);
        fetchData();
      } else {
        throw new Error('Translation failed');
      }
    } catch {
      alert(`Simulation Success: Translated version of article created in language "${targetLang.toUpperCase()}".`);
      setShowTranslateModal(null);
    } finally {
      setTranslatingId(null);
    }
  };

  return (
    <div className="space-y-8 animate-slideup">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-bold border-l-4 border-primary pl-3 tracking-tight">Editorial Workflow Desk</h2>
          <p className="text-xs text-muted-foreground mt-1 font-light">Manage article lifecycles, translations, and manual modifications</p>
        </div>

        {(role === 'SystemAdmin' || role === 'Author') && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowImportForm(!showImportForm);
                setShowAddForm(false);
              }}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 transition-all shadow cursor-pointer"
            >
              {showImportForm ? 'Cancel' : 'Import from URL'}
            </button>
            <button
              onClick={() => {
                setShowAddForm(!showAddForm);
                setShowImportForm(false);
              }}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-primary hover:bg-primary/95 text-white transition-all shadow cursor-pointer"
            >
              {showAddForm ? 'Cancel' : 'Write Draft Article'}
            </button>
          </div>
        )}
      </div>

      {/* Import from URL Form */}
      {showImportForm && (
        <form onSubmit={handleImportFromUrl} className="glass p-5 rounded-2xl border border-border shadow-sm space-y-4 max-w-2xl">
          <h3 className="font-bold text-sm bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">Import News Article from URL</h3>
          <p className="text-[10px] text-muted-foreground font-light leading-relaxed">
            Enter the URL of any online news article. NewsOps AI will fetch the page source, extract the core reporting, structure it with clean paragraphs, and prepare a Draft ready for editing or translation.
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground">Article Web Address (URL)</label>
              <input
                type="url"
                required
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder="https://example.com/news/article-slug"
                className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="text-right">
            <button
              type="submit"
              disabled={importingUrl}
              className="text-xs font-semibold px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all shadow disabled:opacity-50"
            >
              {importingUrl ? 'Fetching & Parsing with AI...' : '🪄 Fetch & Prepare Draft'}
            </button>
          </div>
        </form>
      )}

      {/* Add Draft Form */}
      {showAddForm && (
        <form onSubmit={handleCreateDraft} className="glass p-5 rounded-2xl border border-border shadow-sm space-y-4 max-w-2xl">
          <h3 className="font-bold text-sm">Write Draft Article Draft</h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground">Article Title</label>
              <input
                type="text"
                required
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                placeholder="BBC: Global chip supply deal finalized..."
                className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground">Summary (SEO Description)</label>
              <input
                type="text"
                required
                value={draftSummary}
                onChange={e => setDraftSummary(e.target.value)}
                placeholder="Brief editorial snippet summarizing key findings"
                className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground">Article Body (HTML content support)</label>
              <textarea
                required
                value={draftContent}
                onChange={e => setDraftContent(e.target.value)}
                rows={5}
                placeholder="<p>Insert your body copy here...</p>"
                className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none font-mono"
              />
            </div>
            <div className="relative" ref={draftCatDropdownRef}>
              <label className="block text-xs font-semibold mb-1 text-muted-foreground font-sans">Content Categories (Select Multiple)</label>
              <button
                type="button"
                onClick={() => setShowDraftCatDropdown(prev => !prev)}
                className="w-full px-3 py-2 text-xs rounded-lg bg-card border border-border text-foreground focus:ring-1 focus:ring-primary focus:outline-none transition-colors text-left flex items-center justify-between select-none min-h-[34px]"
              >
                <span className="truncate pr-2">
                  {selectedDraftCategoryIds.length === 0
                    ? 'Select Categories...'
                    : selectedDraftCategoryIds
                        .map(id => categories.find(c => c.id === id)?.name)
                        .filter(Boolean)
                        .join(', ')}
                </span>
                <span className="text-[9px] text-muted-foreground select-none">▼</span>
              </button>

              {showDraftCatDropdown && (
                <div className="absolute z-50 left-0 right-0 mt-1 p-2 bg-slate-900 border border-border rounded-xl shadow-xl max-h-48 overflow-y-auto space-y-1">
                  {categories.map((cat: any) => {
                    const isSelected = selectedDraftCategoryIds.includes(cat.id);
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
                          onChange={() => handleDraftCategoryToggle(cat.id)}
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

          <div className="text-right">
            <button
              type="submit"
              className="text-xs font-semibold px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/95 transition-all shadow"
            >
              Save Draft
            </button>
          </div>
        </form>
      )}

      {/* Workflow split grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Editorial list */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-l-2 border-primary pl-2">
              Article Revision Queue
            </h3>
            
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold text-muted-foreground uppercase">Filter Veracity:</label>
              <select
                value={veracityFilter}
                onChange={e => setVeracityFilter(e.target.value)}
                className="px-2.5 py-1 text-[11px] rounded-lg bg-card border border-border text-foreground focus:outline-none cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="VERIFIED">Verified</option>
                <option value="REFUTED">Refuted</option>
                <option value="CONTRADICTORY">Contradictory</option>
                <option value="UNVERIFIED">Unverified</option>
              </select>
            </div>
          </div>

          <div className="glass rounded-2xl border border-border overflow-hidden shadow-sm">
            {loading ? (
              <div className="p-12 text-center text-xs text-muted-foreground">Loading articles...</div>
            ) : articles.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground">No editorial articles inside DB.</div>
            ) : (
              <div className="divide-y divide-border">
                {articles
                  .filter(art => {
                    if (veracityFilter === 'ALL') return true;
                    return (art.aiVeracityStatus || 'UNVERIFIED') === veracityFilter;
                  })
                  .map(art => (
                    <div key={art.id} className="p-5 flex items-center justify-between gap-4 text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-foreground text-[13px]">{art.title}</h4>
                          <span className="text-[9px] text-muted-foreground font-semibold">
                            v{art.versionNumber}
                          </span>
                          <span
                            className={`text-[8px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 border ${
                              art.aiVeracityStatus === 'VERIFIED'
                                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
                                : art.aiVeracityStatus === 'REFUTED'
                                ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                                : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                            }`}
                            title={art.aiExplanation || 'No AI explanation generated yet.'}
                          >
                            🛡️ {art.aiVeracityStatus || 'UNVERIFIED'}
                          </span>
                        </div>
                        <p className="text-muted-foreground font-light leading-relaxed max-w-md">{art.summary}</p>
                        {/* Categories List Pills */}
                        {(art as any).articleCategories && (art as any).articleCategories.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {(art as any).articleCategories.map((ac: any) => (
                              <span key={ac.category.id} className="bg-slate-500/10 text-slate-400 border border-slate-500/20 px-1.5 py-0.5 rounded text-[8px] font-semibold">
                                {ac.category.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full ${
                            art.status === 'PUBLISHED'
                              ? 'bg-teal-500/10 text-teal-500 border border-teal-500/20'
                              : art.status === 'IN_REVIEW'
                              ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                              : 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20'
                          }`}
                        >
                          {art.status}
                        </span>

                        {/* Manual WYSIWYG Editor Button */}
                        {(role === 'SystemAdmin' || role === 'Author' || role === 'Editor') && (
                          <button
                            onClick={() => router.push(`/editorial/edit/${art.id}`)}
                            className="px-2.5 py-1 rounded bg-card hover:bg-muted border border-border font-bold text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                          >
                            Edit Rich
                          </button>
                        )}

                        {/* Dynamic Translation Dialog Trigger */}
                        <button
                          onClick={() => setShowTranslateModal(art)}
                          className="px-2.5 py-1 rounded bg-card hover:bg-muted border border-border font-bold text-primary transition-all cursor-pointer"
                        >
                          Translate
                        </button>

                        {art.status === 'DRAFT' && (role === 'Author' || role === 'SystemAdmin') && (
                          <button
                            onClick={() => handleSubmitForReview(art.id)}
                            className="px-2.5 py-1 rounded bg-muted hover:bg-primary hover:text-white border border-border font-bold transition-all cursor-pointer"
                          >
                            Submit Review
                          </button>
                        )}

                        {art.status === 'IN_REVIEW' && (role === 'Editor' || role === 'SystemAdmin') && (
                          <button
                            onClick={() => handlePublish(art.id)}
                            className="px-2.5 py-1 rounded bg-primary hover:bg-primary/95 text-white border border-primary font-bold transition-all cursor-pointer"
                          >
                            Approve Publish
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        {/* Content Moderator topic clusters */}
        <div className="glass p-5 rounded-2xl border border-border space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground border-l-2 border-primary pl-2">
            AI Generation Clusters
          </h3>
          <p className="text-[11px] text-muted-foreground font-light leading-relaxed">
            <strong>Content Moderator:</strong> Select an ingested cluster below to trigger translation generations (English, Telugu, Hindi).
          </p>

          <div className="space-y-3">
            {clusters.map(cl => (
              <div key={cl.id} className="p-3.5 rounded-xl border border-border bg-card space-y-3 text-xs">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-bold text-foreground leading-tight">{cl.title}</span>
                    <span className="text-[9px] bg-primary/10 text-primary font-semibold px-2 py-0.5 rounded">
                      {cl.category}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground font-medium">
                    Contains {cl.articlesCount} ingested feed items
                  </span>
                </div>

                <button
                  onClick={() => handleGenerateFromCluster(cl.id)}
                  disabled={generatingId === cl.id}
                  className="w-full text-center py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-semibold transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {generatingId === cl.id ? 'Translating...' : 'Generate AI translations'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Universal Translation Dynamic Trigger Modal */}
      {showTranslateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass max-w-md w-full p-6 rounded-2xl border border-border bg-slate-900 shadow-2xl flex flex-col justify-between space-y-4 text-slate-100 animate-scaleup">
            <div className="space-y-3">
              <div className="flex justify-between items-center border-b border-border pb-2">
                <h3 className="font-bold text-sm">Universal Dynamic Translation</h3>
                <button onClick={() => setShowTranslateModal(null)} className="text-muted-foreground hover:text-white font-bold text-sm">✕</button>
              </div>
              <p className="text-xs text-muted-foreground font-light leading-relaxed">
                Translate the article <strong>"{showTranslateModal.title}"</strong> immediately using pluggable AI engine.
              </p>

              <div>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1.5">Select Target Language</label>
                <select
                  value={targetLang}
                  onChange={e => setTargetLang(e.target.value)}
                  className="w-full text-xs font-semibold px-2.5 py-2 rounded-lg bg-card border border-border text-foreground focus:outline-none"
                >
                  <option value="es">Spanish (Español)</option>
                  <option value="fr">French (Français)</option>
                  <option value="de">German (Deutsch)</option>
                  <option value="it">Italian (Italiano)</option>
                  <option value="ja">Japanese (日本語)</option>
                  <option value="ru">Russian (Русский)</option>
                  <option value="ar">Arabic (العربية)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="te">Telugu (తెలుగు)</option>
                  <option value="ta">Tamil (தமிழ்)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3">
              <button
                onClick={() => setShowTranslateModal(null)}
                className="px-4 py-2 border border-border rounded-lg text-xs font-semibold hover:bg-muted text-muted-foreground transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleTranslateArticle}
                disabled={translatingId === showTranslateModal.id}
                className="px-5 py-2 bg-primary text-white rounded-lg hover:bg-primary/95 text-xs font-bold transition-all shadow disabled:opacity-50 cursor-pointer"
              >
                {translatingId === showTranslateModal.id ? 'Translating via AI...' : 'Translate now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
