'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useApp } from '../../client-layout';
import Link from 'next/link';

interface Comment {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
  replies?: Comment[];
}

interface ArticleDetail {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  publishedAt: string | null;
  category: { name: string } | null;
  tags?: { tag: { name: string } }[];
}

const SUPPORTED_LANGS = [
  { code: 'en', name: 'English' },
  { code: 'te', name: 'Telugu' },
  { code: 'hi', name: 'Hindi' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
];

export default function ArticleDetail() {
  const { slug } = useParams();
  const router = useRouter();
  const { user, setShowPaywall } = useApp();

  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [translatedArticle, setTranslatedArticle] = useState<ArticleDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [likes, setLikes] = useState(12);
  const [hasLiked, setHasLiked] = useState(false);
  const [commentText, setCommentText] = useState('');
  
  // Translation toggle states
  const [activeLang, setActiveLang] = useState('en');
  const [translating, setTranslating] = useState(false);

  // Voice Reader states
  const [isPlayingVoice, setIsPlayingVoice] = useState(false);
  const [isPausedVoice, setIsPausedVoice] = useState(false);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
    }
    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  const handleSpeak = () => {
    if (!synthRef.current || !translatedArticle) return;

    if (isPlayingVoice) {
      if (isPausedVoice) {
        synthRef.current.resume();
        setIsPausedVoice(false);
      } else {
        synthRef.current.pause();
        setIsPausedVoice(true);
      }
      return;
    }

    synthRef.current.cancel();

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = translatedArticle.content;
    const plainText = `${translatedArticle.title}. ${translatedArticle.summary}. ${tempDiv.innerText}`;

    const utterance = new SpeechSynthesisUtterance(plainText);
    utteranceRef.current = utterance;

    const voices = synthRef.current.getVoices();
    const langVoice = voices.find(v => v.lang.startsWith(activeLang)) || voices.find(v => v.lang.startsWith('en'));
    if (langVoice) {
      utterance.voice = langVoice;
    }

    utterance.onend = () => {
      setIsPlayingVoice(false);
      setIsPausedVoice(false);
    };

    utterance.onerror = () => {
      setIsPlayingVoice(false);
      setIsPausedVoice(false);
    };

    setIsPlayingVoice(true);
    setIsPausedVoice(false);
    synthRef.current.speak(utterance);
  };

  const handleStopSpeaking = () => {
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsPlayingVoice(false);
    setIsPausedVoice(false);
  };

  const getBaseSlug = (s: string) => {
    return s.replace(/-(te|hi|es|fr|de|ja|it|ta)$/, '');
  };

  const translateTextClientSide = async (text: string, targetLang: string): Promise<string> => {
    if (!text) return '';
    try {
      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && data[0]) {
          return data[0].map((x: any) => x[0]).join('');
        }
      }
    } catch (err) {
      console.error('Client-side translation error:', err);
    }
    return text;
  };

  const translateHtmlClientSide = async (html: string, targetLang: string): Promise<string> => {
    if (!html) return '';
    try {
      const parts = html.split(/(<[^>]+>)/);
      const translatedParts = await Promise.all(
        parts.map(async (part) => {
          if (part.startsWith('<') && part.endsWith('>')) {
            return part;
          }
          if (part.trim().length === 0) return part;
          return await translateTextClientSide(part, targetLang);
        })
      );
      return translatedParts.join('');
    } catch (err) {
      console.error('HTML translation error:', err);
      return html;
    }
  };

  const getOriginalSourceUrl = (content: string) => {
    if (!content) return 'https://techcrunch.com';
    
    // Find all links in the content
    const matches = [...content.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)];
    if (matches.length > 0) {
      for (let i = matches.length - 1; i >= 0; i--) {
        const url = matches[i][1];
        if (!url.includes('pollinations.ai') && !url.includes('localhost')) {
          return url;
        }
      }
    }
    return 'https://techcrunch.com';
  };

  const loadContent = async (targetSlug: string, langCode: string) => {
    setLoading(true);
    try {
      const articleRes = await fetch(`http://localhost:3001/api/v1/public/articles/${targetSlug}`);
      if (articleRes.ok) {
        const artData = await articleRes.json();
        setArticle(artData);
        setTranslatedArticle(artData);
        setActiveLang(langCode);

        // Fetch comments
        const commentsRes = await fetch(`http://localhost:3001/api/v1/public/articles/${artData.id}/comments`);
        if (commentsRes.ok) {
          const commData = await commentsRes.json();
          setComments(commData);
        }
      } else {
        throw new Error('Not found');
      }
    } catch {
      // Mock data fallback if offline
      const base = getBaseSlug(targetSlug);
      const isTranslated = langCode !== 'en';
      
      const mockArticle: ArticleDetail = {
        id: 'mock_art_id',
        title: isTranslated 
          ? `[${langCode.toUpperCase()}] AI Ingestion Engine Outperforms Human Content Aggregation Speed`
          : 'AI Ingestion Engine Outperforms Human Content Aggregation Speed',
        slug: targetSlug,
        summary: isTranslated
          ? `[${langCode.toUpperCase()}] Detailed look into the NewsOps publication pipelines, event schedulers, and AI models.`
          : 'Detailed look into the NewsOps publication pipelines, event schedulers, and AI models.',
        content: isTranslated
          ? `<p>[${langCode.toUpperCase()} Content] The engineering team at <strong>Naveen Publications</strong> has successfully launched the core CMS engine of <strong>NewsOps Cloud</strong>.</p>
             <p>This text has been translated into ${SUPPORTED_LANGS.find(l => l.code === langCode)?.name} via AI orchestration pipelines.</p>`
          : `<p>The engineering team at <strong>Naveen Publications</strong> has officially launched the core CMS engine of <strong>NewsOps Cloud</strong>.</p>
             <p>By leveraging a NestJS modular monolith back-end coupled with Next.js front-ends, the publishing platform delivers under 200ms latency globally via Cloudflare Edge networks.</p>`,
        publishedAt: new Date().toISOString(),
        category: { name: 'Technology' },
        tags: [
          { tag: { name: 'PostgreSQL' } },
          { tag: { name: 'NextJS' } },
          { tag: { name: 'Artificial Intelligence' } },
        ],
      };
      setArticle(mockArticle);
      setTranslatedArticle(mockArticle);
      setActiveLang(langCode);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (slug) {
      // Determine initial active language from slug suffix
      const match = (slug as string).match(/-(te|hi|es|fr|de|ja|it|ta)$/);
      const initialLang = match ? match[1] : 'en';
      loadContent(slug as string, initialLang);
    }
  }, [slug]);

  const handleLanguageChange = async (langCode: string) => {
    if (!article) return;
    if (langCode === activeLang) return;

    setTranslating(true);
    try {
      if (langCode === 'en') {
        setTranslatedArticle(article);
        setActiveLang('en');
      } else {
        const translatedTitle = await translateTextClientSide(article.title, langCode);
        const translatedSummary = await translateTextClientSide(article.summary, langCode);
        const translatedContent = await translateHtmlClientSide(article.content, langCode);

        setTranslatedArticle({
          ...article,
          title: translatedTitle,
          summary: translatedSummary,
          content: translatedContent,
        });
        setActiveLang(langCode);
      }
    } catch (err) {
      alert('Client-side translation failed. Reverting to original.');
      setTranslatedArticle(article);
      setActiveLang('en');
    } finally {
      setTranslating(false);
    }
  };

  const handleLike = () => {
    if (!user) {
      setShowPaywall(true);
      return;
    }
    if (hasLiked) {
      setLikes(prev => prev - 1);
      setHasLiked(false);
    } else {
      setLikes(prev => prev + 1);
      setHasLiked(true);
    }
  };

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowPaywall(true);
      return;
    }
    if (!commentText.trim()) return;

    try {
      const token = localStorage.getItem('newsops_token');
      const res = await fetch(`http://localhost:3001/api/v1/public/articles/${article?.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ content: commentText }),
      });
      if (res.ok) {
        const newComm = await res.json();
        setComments(prev => [...prev, { ...newComm, replies: [] }]);
        setCommentText('');
      } else {
        throw new Error('Offline');
      }
    } catch {
      const mockComment: Comment = {
        id: 'new_c_' + Math.random(),
        authorName: `${user.firstName} ${user.lastName}`,
        content: commentText,
        createdAt: new Date().toISOString(),
        replies: [],
      };
      setComments(prev => [...prev, mockComment]);
      setCommentText('');
    }
  };

  const handleShare = () => {
    if (navigator.share) {
      navigator.share({
        title: article?.title,
        text: article?.summary,
        url: window.location.href,
      }).catch(() => {});
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert('Article link copied to clipboard!');
    }
  };

  const CommentNode = ({ node }: { node: Comment }) => (
    <div className="space-y-4 border-l-2 border-border/60 pl-4 py-2 mt-4 ml-2 animate-slideup">
      <div className="flex justify-between items-center text-xs">
        <span className="font-bold text-foreground">{node.authorName}</span>
        <span className="text-muted-foreground">{new Date(node.createdAt).toLocaleTimeString()}</span>
      </div>
      <p className="text-sm text-foreground/80 leading-relaxed font-light">{node.content}</p>
      
      {node.replies && node.replies.map(reply => (
        <CommentNode key={reply.id} node={reply} />
      ))}
    </div>
  );

  if (loading || translating) {
    return <div className="animate-pulse bg-card border border-border h-96 rounded-2xl flex items-center justify-center text-xs text-muted-foreground">Loading article content translation ({activeLang.toUpperCase()})...</div>;
  }

  if (!translatedArticle) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold">Article not found</h2>
        <Link href="/" className="text-primary text-sm font-semibold underline mt-3 inline-block">Return Home</Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-slideup">
      {/* Back button and Language Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 pb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-primary transition-colors border border-border px-3 py-1.5 rounded-lg bg-card max-w-[120px]"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to feed
        </Link>

        {/* Translation tab list */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-muted/60 border border-border rounded-xl">
          {SUPPORTED_LANGS.map(l => (
            <button
              key={l.code}
              onClick={() => handleLanguageChange(l.code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeLang === l.code
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {l.name}
            </button>
          ))}
        </div>
      </div>

      {/* Voice Reader controls */}
      <div className="glass border border-border/60 rounded-xl p-3.5 flex items-center justify-between gap-4 shadow-sm text-xs select-none">
        <div className="flex items-center gap-2 text-muted-foreground font-medium">
          {isPlayingVoice ? (
            <>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-emerald-500 font-semibold">
                {isPausedVoice ? 'Speech Paused' : 'Voice Reader Active...'}
              </span>
            </>
          ) : (
            <>
              <span>🔊 Audio Voice Reader Available</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSpeak}
            className={`px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 border ${
              isPlayingVoice
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-500 hover:bg-amber-500/20'
                : 'bg-primary/10 border-primary/20 text-primary hover:bg-primary/20'
            }`}
          >
            {isPlayingVoice ? (
              isPausedVoice ? (
                <>▶ Resume</>
              ) : (
                <>⏸ Pause</>
              )
            ) : (
              <>▶ Read Article</>
            )}
          </button>
          
          {isPlayingVoice && (
            <button
              onClick={handleStopSpeaking}
              className="px-3.5 py-1.5 rounded-lg font-bold bg-rose-500/10 border border-rose-500/20 text-rose-500 hover:bg-rose-500/20 transition-all"
            >
              ⏹ Stop
            </button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="space-y-4">
        <div className="flex gap-2">
          {translatedArticle.category && (
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
              {translatedArticle.category.name}
            </span>
          )}
        </div>
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight leading-tight text-foreground">
          {translatedArticle.title}
        </h1>
        <p className="text-sm md:text-base text-muted-foreground font-light leading-relaxed">
          {translatedArticle.summary}
        </p>

        <div className="flex flex-wrap gap-4 items-center justify-between border-y border-border py-4 text-xs font-medium text-muted-foreground">
          <div>
            Published by <span className="text-foreground font-semibold">Staff Writer</span>
            {translatedArticle.publishedAt && ` on ${new Date(translatedArticle.publishedAt).toLocaleDateString()}`}
          </div>
          
          <div className="flex gap-4">
            <button
              onClick={handleLike}
              className={`flex items-center gap-1.5 hover:text-primary transition-colors ${
                hasLiked ? 'text-primary' : ''
              }`}
            >
              <svg className="w-5 h-5" fill={hasLiked ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              {likes}
            </button>
            <button onClick={handleShare} className="flex items-center gap-1.5 hover:text-primary transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 10.742l4.085-2.042m0 6.6l-4.086-2.043M18 12a3 3 0 11-6 0 3 3 0 016 0zm-11 5a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Share
            </button>
          </div>
        </div>
      </div>

      {/* Article Body Content */}
      <article className="prose prose-slate dark:prose-invert max-w-none prose-headings:font-extrabold prose-p:leading-relaxed prose-p:font-light prose-p:text-base prose-blockquote:border-primary prose-blockquote:bg-muted/40 prose-blockquote:p-4 prose-blockquote:rounded-r-lg">
        <div dangerouslySetInnerHTML={{ __html: translatedArticle.content }} />
      </article>

      {/* Original Source Reference */}
      <div className="p-4 rounded-xl bg-muted border border-border flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">This article references reports from external syndicates.</span>
        <a
          href={getOriginalSourceUrl(translatedArticle.content)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold text-primary hover:underline"
        >
          View original source URL
        </a>
      </div>

      {/* In-Article Sponsored Advertisement Slot */}
      <div className="my-8 rounded-xl bg-slate-900 border border-border p-5 space-y-4">
        <div className="flex justify-between items-center text-[9px] uppercase tracking-wider text-muted-foreground font-bold">
          <span>Sponsored Content</span>
          <span>Advertisement</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="w-full sm:w-32 h-20 rounded-lg bg-gradient-to-br from-indigo-500 to-primary flex items-center justify-center text-white font-extrabold text-sm shadow shrink-0">
            Tech Space
          </div>
          <div className="space-y-1 text-center sm:text-left">
            <h4 className="text-sm font-bold text-foreground">Accelerate Your Media Workflows</h4>
            <p className="text-xs text-muted-foreground font-light leading-relaxed">
              Leverage pluggable AI content engines, clean zero-key translations, and automated metadata extraction out-of-the-box.
            </p>
          </div>
        </div>
      </div>

      {/* Comments block */}
      <div className="space-y-6 pt-6 border-t border-border">
        <h2 className="text-xl font-bold border-l-4 border-primary pl-3 tracking-tight">
          Discussion Board ({comments.length})
        </h2>

        {/* Comment form */}
        <form onSubmit={handleCommentSubmit} className="space-y-3">
          <textarea
            placeholder={user ? "Share your view on this article..." : "You must be signed in to submit comments."}
            disabled={!user}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl bg-card border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary text-foreground disabled:opacity-50"
          />
          <div className="text-right">
            {user ? (
              <button
                type="submit"
                className="px-5 py-2.5 rounded-lg bg-primary hover:bg-primary/95 text-white text-xs font-semibold hover:shadow-md transition-all duration-300"
              >
                Post Comment
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowPaywall(true)}
                className="px-5 py-2.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-semibold transition-all"
              >
                Login to Comment
              </button>
            )}
          </div>
        </form>

        {/* Comments tree */}
        <div className="space-y-2 pt-2 divide-y divide-border/40">
          {comments.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No discussions yet. Start the conversation!</p>
          ) : (
            comments.map(node => (
              <CommentNode key={node.id} node={node} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
