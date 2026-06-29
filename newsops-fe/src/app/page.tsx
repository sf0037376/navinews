'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content?: string;
  status: string;
  publishedAt: string | null;
  category: { name: string } | null;
  coverImage?: string | null;
}

const getFirstImage = (content: string) => {
  if (!content) return null;
  const match = content.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match ? match[1] : null;
};

export default function Home() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeLang, setActiveLang] = useState('All');
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [limit, setLimit] = useState(6);
  const [hasMore, setHasMore] = useState(true);

  // Load articles
  const loadArticles = async (currentLimit: number) => {
    setLoading(true);
    try {
      let url = `http://localhost:3001/api/v1/public/articles?limit=${currentLimit}`;
      if (searchQuery) {
        url += `&q=${encodeURIComponent(searchQuery)}`;
      }
      if (activeCategory && activeCategory !== 'All') {
        url += `&category=${encodeURIComponent(activeCategory)}`;
      }
      
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        let filtered = data;
        if (activeLang === 'hi') {
          filtered = filtered.filter((a: any) => a.title.includes('[HINDI]') || a.title.includes('हिंदी') || a.title.includes('समाचार'));
        } else if (activeLang === 'te') {
          filtered = filtered.filter((a: any) => a.title.includes('[TELUGU]') || a.title.includes('న్యూస్') || a.title.includes('ఆప్స్'));
        } else if (activeLang === 'en') {
          filtered = filtered.filter((a: any) => !a.title.includes('[HINDI]') && !a.title.includes('[TELUGU]'));
        }
        setArticles(filtered);
        setHasMore(data.length >= currentLimit);
      } else {
        throw new Error('Offline');
      }
    } catch {
      // Return high-quality visual mock articles if backend is offline
      const mockArticles: Article[] = [
        {
          id: '1',
          title: 'AI Ingestion Engine Outperforms Human Content Aggregation Speed',
          slug: 'ai-ingestion-engine-speed',
          summary: 'The new RSS Monitor system processes thousands of feed articles per minute with SHA-256 fingerprint deduplication checking.',
          content: 'Full content',
          status: 'PUBLISHED',
          publishedAt: new Date().toISOString(),
          category: { name: 'Technology' },
        },
        {
          id: '2',
          title: 'Naveen Publications Announces Global Launch of NewsOps AI CMS Platform',
          slug: 'naveen-publications-newsops-launch',
          summary: 'A new standard in newsroom workflows: automated summaries, Telugu and Hindi translations, and pluggable AI providers.',
          content: 'Full content',
          status: 'PUBLISHED',
          publishedAt: new Date().toISOString(),
          category: { name: 'Business' },
        },
        {
          id: '3',
          title: '[TELUGU] న్యూస్ ఆప్స్ ప్లాట్‌ఫారమ్ ఆవిష్కరణ: డిజిటల్ జర్నలిజం కొత్త యుగం',
          slug: 'newsops-launch-te',
          summary: 'నవీన్ పబ్లికేషన్స్ అధునాతన ఆర్టిఫిషియల్ ఇంటెలిజెన్స్ ఆధారిత వార్తా వేదికను అందుబాటులోకి తీసుకువచ్చింది.',
          content: 'Full content',
          status: 'PUBLISHED',
          publishedAt: new Date().toISOString(),
          category: { name: 'Technology' },
        },
        {
          id: '4',
          title: '[HINDI] मीडिया प्रकाशनों के लिए एआई-संचालित संपादकीय स्टूडियो का विकास',
          slug: 'ai-editorial-studio-hi',
          summary: 'नवीन पब्लिकेशन्स ने नए डिजिटल ऑपरेटिंग सिस्टम का खुलासा किया जो समाचारों का अनुवाद और संपादन स्वचालित रूप से करता है।',
          content: 'Full content',
          status: 'PUBLISHED',
          publishedAt: new Date().toISOString(),
          category: { name: 'Politics' },
        },
      ];
      
      let filtered = mockArticles;
      if (activeCategory !== 'All') {
        filtered = filtered.filter(a => a.category?.name === activeCategory);
      }
      if (activeLang === 'hi') {
        filtered = filtered.filter(a => a.title.includes('[HINDI]'));
      } else if (activeLang === 'te') {
        filtered = filtered.filter(a => a.title.includes('[TELUGU]'));
      } else if (activeLang === 'en') {
        filtered = filtered.filter(a => !a.title.includes('[HINDI]') && !a.title.includes('[TELUGU]'));
      }
      
      if (searchQuery) {
        filtered = filtered.filter(a =>
          a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.summary.toLowerCase().includes(searchQuery.toLowerCase())
        );
      }

      setArticles(filtered);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLimit(6);
    loadArticles(6);
  }, [searchQuery, activeCategory, activeLang]);

  const handleLoadMore = () => {
    const nextLimit = limit + 6;
    setLimit(nextLimit);
    loadArticles(nextLimit);
  };

  // Carousel timer
  useEffect(() => {
    if (articles.length === 0) return;
    const interval = setInterval(() => {
      setCarouselIndex(prev => (prev + 1) % Math.min(articles.length, 3));
    }, 6000);
    return () => clearInterval(interval);
  }, [articles]);

  const carouselArticles = articles.slice(0, 3);

  return (
    <div className="space-y-10 animate-slideup">
      {/* 1. Breaking News Carousel */}
      {carouselArticles.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl h-[420px] shadow-xl border border-border group animate-fadein">
          {carouselArticles.map((art, idx) => {
            const coverImg = art.coverImage;
            return (
              <div
                key={art.id}
                className={`absolute inset-0 transition-opacity duration-700 flex flex-col justify-end p-6 md:p-12 ${
                  idx === carouselIndex ? 'opacity-100 z-10' : 'opacity-0 z-0'
                }`}
                style={{
                  backgroundImage: coverImg
                    ? `linear-gradient(to top, rgba(2, 6, 23, 0.95) 0%, rgba(2, 6, 23, 0.45) 50%, rgba(2, 6, 23, 0.1) 100%), url(${coverImg})`
                    : 'none',
                  backgroundColor: coverImg ? 'transparent' : '#0f172a',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div className="space-y-4 max-w-3xl text-white drop-shadow-lg">
                  <div className="flex gap-3">
                    <span className="text-xs uppercase bg-primary px-3 py-1 rounded-full font-bold tracking-wider shadow-md">
                      Breaking
                    </span>
                    {art.category && (
                      <span className="text-xs uppercase bg-white/20 backdrop-blur-md px-3 py-1 rounded-full font-bold tracking-wider shadow-md border border-white/10">
                        {art.category.name}
                      </span>
                    )}
                  </div>
                  
                  <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight leading-tight hover:text-primary transition-colors">
                    <Link href={`/articles/${art.slug}`}>
                      {art.title}
                    </Link>
                  </h1>
                  
                  <p className="text-sm md:text-base text-slate-200 leading-relaxed max-w-2xl font-light">
                    {art.summary}
                  </p>
                  
                  <div className="pt-2">
                    <Link
                      href={`/articles/${art.slug}`}
                      className="inline-flex items-center gap-2 text-xs font-semibold text-primary hover:text-white bg-white hover:bg-primary px-5 py-2.5 rounded-lg shadow-md transition-all duration-300 transform hover:scale-105"
                    >
                      Read Full Story
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Dots Indicator */}
          <div className="absolute top-4 right-4 z-20 flex gap-2">
            {carouselArticles.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCarouselIndex(idx)}
                className={`w-3 h-3 rounded-full transition-all border border-white/40 ${
                  idx === carouselIndex ? 'bg-primary scale-125' : 'bg-white/40'
                }`}
                aria-label={`Go to slide ${idx + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Premium Sponsored Advertisement Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-lg">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-2xl" />
        <div className="space-y-2">
          <span className="text-[9px] uppercase font-extrabold tracking-widest bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-0.5 rounded-full">
            Sponsored
          </span>
          <h3 className="font-extrabold text-base md:text-lg tracking-tight text-white leading-tight">
            Upgrade Your Workspace with Newsroom Enterprise Cloud
          </h3>
          <p className="text-xs text-slate-300 font-light leading-relaxed max-w-xl">
            Unlock multi-tenant workspaces, webhook configurations, secure roles auditing, and high-frequency automated scraping models.
          </p>
        </div>
        <a
          href="#"
          className="shrink-0 bg-primary hover:bg-primary/95 text-white text-xs font-bold px-5 py-2.5 rounded-lg shadow hover:shadow-lg transition-all"
        >
          Learn More
        </a>
      </div>

      {/* 2. Filter & Search Controls */}
      <div className="glass p-5 rounded-2xl border border-border shadow-sm flex flex-col md:flex-row items-center gap-4 justify-between transition-all">
        {/* Categories Tab */}
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {['All', 'Technology', 'Politics', 'Business'].map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`text-xs font-semibold px-4 py-2 rounded-lg transition-all border ${
                activeCategory === cat
                  ? 'bg-primary text-white border-primary shadow-sm'
                  : 'bg-card hover:bg-muted text-muted-foreground border-border'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Search Input and Lang Filters */}
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          {/* Language Selector */}
          <select
            value={activeLang}
            onChange={(e) => setActiveLang(e.target.value)}
            className="text-xs font-semibold px-3 py-2 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="All">All Languages</option>
            <option value="en">English</option>
            <option value="hi">हिंदी (Hindi)</option>
            <option value="te">తెలుగు (Telugu)</option>
          </select>

          <div className="relative w-full sm:w-64">
            <input
              type="text"
              placeholder="Search news..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-card border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
            />
            <svg
              className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* 3. Latest News Grid */}
      <div className="space-y-6">
        <h2 className="text-xl font-bold border-l-4 border-primary pl-3 tracking-tight">
          Latest Publications
        </h2>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse bg-card rounded-2xl border border-border h-72" />
            ))}
          </div>
        ) : articles.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-2xl bg-card">
            <svg className="w-12 h-12 text-muted-foreground mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm font-semibold text-muted-foreground">No articles match your selection.</p>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {articles.map((art) => {
                const coverImg = art.coverImage;
                return (
                  <article
                    key={art.id}
                    className="bg-card text-card-foreground rounded-2xl border border-border overflow-hidden hover-card flex flex-col justify-between animate-fadein"
                  >
                    <div className="h-48 w-full overflow-hidden relative bg-slate-900 border-b border-border/30 flex items-center justify-center">
                      {coverImg ? (
                        <img
                          src={coverImg}
                          alt=""
                          className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center">
                          <svg className="w-8 h-8 text-indigo-500/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.656 48.656 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7C4.68 9.547 4.636 10.768 4.636 12c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.092-1.209.138-2.43.138-3.662z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </div>
                      )}
                      <span className="absolute top-3 left-3 text-[10px] font-bold text-white bg-primary uppercase tracking-widest px-2.5 py-1 rounded-full shadow-md border border-primary/20 backdrop-blur-sm bg-primary/90">
                        {art.category?.name || 'General'}
                      </span>
                    </div>

                    <div className="p-5 space-y-3 flex-grow">
                      <div className="flex justify-between items-center text-[10px] text-muted-foreground font-medium">
                        <span>{art.publishedAt ? new Date(art.publishedAt).toLocaleDateString() : 'Draft'}</span>
                      </div>

                      <h3 className="font-bold text-base md:text-lg leading-snug tracking-tight hover:text-primary transition-colors line-clamp-2">
                        <Link href={`/articles/${art.slug}`}>
                          {art.title}
                        </Link>
                      </h3>

                      <p className="text-xs text-muted-foreground font-normal leading-relaxed line-clamp-3">
                        {art.summary}
                      </p>
                    </div>

                    <div className="p-5 pt-0 flex justify-between items-center border-t border-border/30">
                      <Link
                        href={`/articles/${art.slug}`}
                        className="text-xs font-semibold text-primary inline-flex items-center gap-1 hover:gap-2 transition-all"
                      >
                        Read Article
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>

            {hasMore && articles.length >= limit && (
              <div className="flex justify-center pt-6">
                <button
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="bg-primary hover:bg-primary/95 text-white text-xs font-bold px-6 py-3 rounded-lg shadow-md hover:shadow-lg transition-all duration-300 disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load More Publications'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
