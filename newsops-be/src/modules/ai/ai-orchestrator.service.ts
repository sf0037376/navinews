import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeneratedArticle {
  title: string;
  summary: string;
  content: string;
}

export interface SeoContent {
  seoTitle: string;
  seoDescription: string;
  keywords: string[];
}

export interface ThumbnailPrompt {
  prompt: string;
  altText: string;
}

@Injectable()
export class AiOrchestratorService {
  private readonly logger = new Logger(AiOrchestratorService.name);
  private gemini: any = null;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      try {
        this.gemini = new GoogleGenerativeAI(apiKey);
        this.logger.log('Gemini AI Provider initialized successfully.');
      } catch (err: any) {
        this.logger.error(`Failed to initialize Gemini AI: ${err.message}`);
      }
    } else {
      this.logger.log('Gemini API Key is not configured. Falling back to free Pollinations.ai Router.');
    }
  }

  // Helper: call free Pollinations.ai chat endpoint
  async callPollinations(systemInstruction: string, promptText: string): Promise<string> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const apiKey = process.env.POLLINATIONS_API_KEY;
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }

      const response = await fetch('https://text.pollinations.ai/', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: promptText }
          ]
        })
      });
      if (!response.ok) {
        throw new Error(`Pollinations API error: ${response.statusText}`);
      }
      return await response.text();
    } catch (err: any) {
      this.logger.error(`Pollinations request failed: ${err.message}`);
      return '';
    }
  }

  // 1. Generate Article from prompt/context
  async generateArticle(prompt: string, contextText?: string): Promise<GeneratedArticle> {
    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const systemInstruction = `You are a professional journalist. Generate a complete news article with title, summary, and HTML content. Respond STRICTLY in JSON format with keys: "title", "summary", and "content" (HTML tags formatted).`;
        const promptText = `
          System: ${systemInstruction}
          User Prompt: ${prompt}
          Additional Context/Sources: ${contextText || 'None'}
        `;

        const result = await model.generateContent(promptText);
        const text = result.response.text();
        const cleaned = this.extractJson(text);
        if (cleaned) {
          return cleaned as GeneratedArticle;
        }
      } catch (err: any) {
        this.logger.error(`Gemini Article Generation failed: ${err.message}`);
      }
    }

    // Free Pollinations.ai Fallback
    try {
      this.logger.log('Attempting article generation using free Pollinations.ai...');
      const systemInstruction = `You are a professional journalist. Generate a complete news article with title, summary, and HTML content. Respond STRICTLY in raw JSON format with keys: "title", "summary", and "content" (HTML tags formatted). Do not include markdown code block formatting (i.e. output raw JSON only).`;
      const promptText = `
        User Prompt: ${prompt}
        Additional Context/Sources: ${contextText || 'None'}
      `;
      const resultText = await this.callPollinations(systemInstruction, promptText);
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.title && cleaned.content) {
        return cleaned as GeneratedArticle;
      }
    } catch (err: any) {
      this.logger.warn(`Pollinations.ai generation failed, trying NVIDIA NIM fallback...`);
    }

    // NVIDIA NIM Fallback
    try {
      const systemInstruction = `You are a professional journalist. Generate a complete news article with title, summary, and HTML content. Respond STRICTLY in raw JSON format with keys: "title", "summary", and "content" (HTML tags formatted). Do not include markdown code block formatting (i.e. output raw JSON only).`;
      const promptText = `
        System: ${systemInstruction}
        User Prompt: ${prompt}
        Additional Context/Sources: ${contextText || 'None'}
      `;
      const resultText = await this.callNvidiaNim(promptText);
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.title && cleaned.content) {
        return cleaned as GeneratedArticle;
      }
    } catch (err: any) {
      this.logger.warn(`NVIDIA NIM generation failed, using mock fallback: ${err.message}`);
    }

    this.logger.log('Using static Mock Article Generator');
    return this.mockGenerateArticle(prompt, contextText);
  }

  // Clean translation text to remove reasoning or assistant wrapper text
  private cleanTranslatedText(rawText: string): string {
    if (!rawText) return '';
    let cleaned = rawText.trim();
    
    // Check if it's a JSON structure
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed) {
        if (parsed.content) return this.cleanTranslatedText(parsed.content);
        if (parsed.translatedText) return this.cleanTranslatedText(parsed.translatedText);
        if (parsed.text) return this.cleanTranslatedText(parsed.text);
      }
    } catch {}

    const braceMatch = cleaned.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed = JSON.parse(braceMatch[0]);
        if (parsed) {
          if (parsed.content) return this.cleanTranslatedText(parsed.content);
          if (parsed.translatedText) return this.cleanTranslatedText(parsed.translatedText);
          if (parsed.text) return this.cleanTranslatedText(parsed.text);
        }
      } catch {}
    }

    // Strip markdown code block wrappers
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '');
    }

    // Strip common model prefixes
    cleaned = cleaned.replace(/^(Here is the translation into [a-zA-Z\s]+:|Here is the translated text:|Translation:|We translate:)\s*/i, '');

    return cleaned.trim();
  }

  // 2. Translate Text into dynamic language
  async translateText(text: string, targetLang: 'hi' | 'te' | string): Promise<string> {
    const langNames: Record<string, string> = {
      hi: 'Hindi',
      te: 'Telugu',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      ja: 'Japanese',
      ru: 'Russian',
      ar: 'Arabic',
      ta: 'Tamil'
    };
    const langName = langNames[targetLang.toLowerCase()] || targetLang;

    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const promptText = `Translate the following news content into fluent ${langName}. Preserve HTML tags if present. Return ONLY the translated text.\n\nContent: ${text}`;
        const result = await model.generateContent(promptText);
        return this.cleanTranslatedText(result.response.text());
      } catch (err: any) {
        this.logger.error(`Gemini Translation failed: ${err.message}`);
      }
    }

    // Free Pollinations.ai Fallback
    try {
      this.logger.log(`Attempting translation to ${langName} using free Pollinations.ai...`);
      const systemInstruction = `You are a professional translator. Translate the given text into fluent, natural ${langName}. Preserve all HTML tags exactly. Return ONLY the translated output. Do not explain or comment on your translation.`;
      const promptText = `Text to translate:\n${text}`;
      const resultText = await this.callPollinations(systemInstruction, promptText);
      if (resultText && resultText.trim().length > 0) {
        return this.cleanTranslatedText(resultText);
      }
    } catch (err: any) {
      this.logger.warn(`Pollinations.ai translation failed, trying NVIDIA NIM...`);
    }

    // NVIDIA NIM Fallback
    try {
      const systemInstruction = `You are a professional translator. Translate the given text into fluent, natural ${langName}. Preserve all HTML tags exactly. Return ONLY the translated output. Do not explain or comment on your translation.`;
      const promptText = `
        System: ${systemInstruction}
        Text to translate:\n${text}
      `;
      const resultText = await this.callNvidiaNim(promptText);
      if (resultText && resultText.trim().length > 0) {
        return this.cleanTranslatedText(resultText);
      }
    } catch (err: any) {
      this.logger.warn(`NVIDIA NIM translation failed, using mock: ${err.message}`);
    }

    this.logger.log(`Using static Mock translation for ${langName}`);
    return this.mockTranslate(text, targetLang as any);
  }

  // 3. Generate SEO content
  async generateSeoContent(title: string, content: string): Promise<SeoContent> {
    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const systemInstruction = `Generate SEO metadata from the article title and content. Return STRICTLY in JSON format with keys: "seoTitle" (under 60 chars), "seoDescription" (under 160 chars), and "keywords" (array of strings).`;
        const promptText = `
          System: ${systemInstruction}
          Title: ${title}
          Content: ${content.substring(0, 1000)}
        `;

        const result = await model.generateContent(promptText);
        const text = result.response.text();
        const cleaned = this.extractJson(text);
        if (cleaned) {
          return cleaned as SeoContent;
        }
      } catch (err: any) {
        this.logger.error(`Gemini SEO Generation failed: ${err.message}`);
      }
    }

    // Free Pollinations.ai Fallback
    try {
      const systemInstruction = `Generate SEO metadata from the article title and content. Return STRICTLY in raw JSON format with keys: "seoTitle" (under 60 chars), "seoDescription" (under 160 chars), and "keywords" (array of strings).`;
      const promptText = `Title: ${title}\nContent: ${content.substring(0, 500)}`;
      const resultText = await this.callPollinations(systemInstruction, promptText);
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.seoTitle) {
        return cleaned as SeoContent;
      }
    } catch {}

    // NVIDIA NIM Fallback
    try {
      const systemInstruction = `Generate SEO metadata from the article title and content. Return STRICTLY in JSON format with keys: "seoTitle" (under 60 chars), "seoDescription" (under 160 chars), and "keywords" (array of strings).`;
      const promptText = `
        System: ${systemInstruction}
        Title: ${title}\nContent: ${content.substring(0, 500)}
      `;
      const resultText = await this.callNvidiaNim(promptText);
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.seoTitle) {
        return cleaned as SeoContent;
      }
    } catch {}

    return {
      seoTitle: `${title} | NewsOps`,
      seoDescription: `${title}. Read the latest breaking updates and analysis on NewsOps, powered by AI.`,
      keywords: ['NewsOps', 'Breaking News', 'Latest Updates', 'AI Powered'],
    };
  }

  // 4. Generate Thumbnail image prompt
  async generateThumbnailPrompt(title: string, summary: string): Promise<ThumbnailPrompt> {
    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const systemInstruction = `Create a highly descriptive visual prompt for an AI image generator (like Midjourney or DALL-E) to create a photojournalism-style thumbnail image matching this article. Also provide an alternative accessibility altText. Return STRICTLY in JSON format with keys: "prompt", "altText".`;
        const promptText = `
          System: ${systemInstruction}
          Article Title: ${title}
          Summary: ${summary}
        `;

        const result = await model.generateContent(promptText);
        const text = result.response.text();
        const cleaned = this.extractJson(text);
        if (cleaned) {
          return cleaned as ThumbnailPrompt;
        }
      } catch (err: any) {
        this.logger.error(`Gemini Image Prompt Generation failed: ${err.message}`);
      }
    }

    // Free Pollinations.ai Fallback
    try {
      const systemInstruction = `Create a highly descriptive visual prompt for an AI image generator to create a thumbnail matching this article. Also provide an accessibility altText. Return STRICTLY in raw JSON with keys: "prompt", "altText".`;
      const promptText = `Title: ${title}\nSummary: ${summary}`;
      const resultText = await this.callPollinations(systemInstruction, promptText);
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.prompt) {
        return cleaned as ThumbnailPrompt;
      }
    } catch {}

    // NVIDIA NIM Fallback
    try {
      const systemInstruction = `Create a highly descriptive visual prompt for an AI image generator to create a thumbnail matching this article. Also provide an accessibility altText. Return STRICTLY in JSON format with keys: "prompt", "altText".`;
      const promptText = `
        System: ${systemInstruction}
        Title: ${title}\nSummary: ${summary}
      `;
      const resultText = await this.callNvidiaNim(promptText);
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.prompt) {
        return cleaned as ThumbnailPrompt;
      }
    } catch {}

    return {
      prompt: `Editorial photography, close-up of subjects related to: ${title}, photorealistic, dramatic lighting, news header format.`,
      altText: `A conceptual image illustrating: ${title}`,
    };
  }

  // Helper: extract and parse JSON from Markdown code blocks
  private extractJson(rawText: string): any {
    try {
      let jsonText = rawText.trim();
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.substring(7);
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.substring(3);
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.substring(0, jsonText.length - 3);
      }
      return JSON.parse(jsonText.trim());
    } catch (e) {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  // Mocks
  private mockGenerateArticle(prompt: string, context?: string): GeneratedArticle {
    return {
      title: `AI Report: Insights on "${prompt.substring(0, 80)}"`,
      summary: `Automated summary of updates regarding ${prompt.substring(0, 100)}, analyzing key contextual facts.`,
      content: `
        <p>This article is generated in local development sandbox mode by NewsOps AI. It consolidates analysis for prompt: <strong>"${prompt}"</strong>.</p>
        <p>Based on ingested feeds, global semiconductor outputs, digital operations, and strategic roadmaps present steady indicators of progress. Platforms have shifted to configuration-over-code structures and pluggable provider layers.</p>
        <blockquote>"The zero-cost MVP architecture ensures bootstrapping journalists have instant access to CMS tooling."</blockquote>
        <p>For live environments, insert a valid <code>GEMINI_API_KEY</code> into your backend config variables.</p>
      `,
    };
  }

  private mockTranslate(text: string, targetLang: 'hi' | 'te'): string {
    if (targetLang === 'hi') {
      return `[Hindi]: ${text.replace(/<[^>]*>/g, '')}`;
    }
    return `[Telugu]: ${text.replace(/<[^>]*>/g, '')}`;
  }

  // Call NVIDIA NIM API compatibly (build.nvidia.com)
  async callNvidiaNim(promptText: string): Promise<string> {
    const apiKey = process.env.NVIDIA_API_KEY || 'nvapi-YOUR_NVIDIA_API_KEY';
    this.logger.log('Attempting NVIDIA NIM AI fallback generation...');
    
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'meta/llama-3.2-11b-vision-instruct',
          messages: [
            { role: 'user', content: promptText }
          ],
          temperature: 0.2,
          max_tokens: 1024,
        }),
      });

      if (!response.ok) {
        throw new Error(`NVIDIA NIM API error: ${response.statusText}`);
      }

      const data = await response.json();
      return data?.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      this.logger.error(`NVIDIA NIM fallback request failed: ${err.message}`);
      throw err;
    }
  }

  async verifyArticleVeracity(title: string, content: string): Promise<{ veracityStatus: string; explanation: string }> {
    const prompt = `Analyze the following news article title and content for authenticity, factual consistency, and accuracy.
Determine if the claims in the article are:
1. "VERIFIED" - The facts and claims are historically or currently authentic and factually sound.
2. "REFUTED" - The claims are known hoaxes, factually incorrect, or heavily debunked.
3. "CONTRADICTORY" - The article contains significant self-contradictions or is inconsistent with verified realities.
4. "UNVERIFIED" - The claims cannot be verified due to lack of sources or details.

Return your response strictly in raw JSON format with keys: "status" (must be one of: "VERIFIED", "REFUTED", "CONTRADICTORY", "UNVERIFIED") and "explanation" (a brief summary of the authenticity check, around 2-3 sentences).
Do not wrap the JSON output in markdown tags.

Title: ${title}
Content: ${content.substring(0, 2000)}`;

    if (this.gemini) {
      try {
        const model = this.gemini.getGenerativeModel({ model: 'gemini-1.5-flash' });
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const cleaned = this.extractJson(text);
        if (cleaned && cleaned.status) {
          return {
            veracityStatus: cleaned.status.toUpperCase(),
            explanation: cleaned.explanation || '',
          };
        }
      } catch (err: any) {
        this.logger.error(`Gemini Veracity verification failed: ${err.message}`);
      }
    }

    try {
      const resultText = await this.callPollinations(
        'You are a professional fact-checker. Do not wrap the JSON output in markdown tags or add extra notes.',
        prompt
      );
      const cleaned = this.extractJson(resultText);
      if (cleaned && cleaned.status) {
        return {
          veracityStatus: cleaned.status.toUpperCase(),
          explanation: cleaned.explanation || '',
        };
      }
    } catch (err: any) {
      this.logger.warn(`Pollinations veracity verification failed, trying NVIDIA: ${err.message}`);
    }

    try {
      const resultTextNvidia = await this.callNvidiaNim(prompt);
      const cleaned = this.extractJson(resultTextNvidia);
      if (cleaned && cleaned.status) {
        return {
          veracityStatus: cleaned.status.toUpperCase(),
          explanation: cleaned.explanation || '',
        };
      }
    } catch (err: any) {
      this.logger.warn(`NVIDIA NIM veracity verification failed: ${err.message}`);
    }

    return {
      veracityStatus: 'UNVERIFIED',
      explanation: 'Veracity check completed with unverified status due to API timeouts or services offline.',
    };
  }
}
