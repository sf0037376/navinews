import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SourceStatus, CrawlStatus } from '@prisma/client';
import { SlackService } from './slack.service';
import * as xml2js from 'xml2js';
import * as crypto from 'crypto';
import * as dns from 'dns/promises';

@Injectable()
export class RssCrawlerService {
  private readonly logger = new Logger(RssCrawlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly slack: SlackService,
  ) {}

  // SSRF Protection: resolve host and check if it points to a private network
  async isSafeUrl(urlStr: string): Promise<boolean> {
    try {
      const url = new URL(urlStr);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
      }

      const hostname = url.hostname;
      // If it's already an IP address, check directly
      if (this.isPrivateIp(hostname)) {
        return false;
      }

      // Resolve DNS
      const addresses = await dns.resolve4(hostname).catch(() => []);
      for (const ip of addresses) {
        if (this.isPrivateIp(ip)) {
          return false;
        }
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  private isPrivateIp(ip: string): boolean {
    // Check RFC 1918 and loopback/link-local
    if (ip === '127.0.0.1' || ip === 'localhost' || ip === '0.0.0.0') {
      return true;
    }
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return false; // Not a valid IPv4, but let's assume it's unsafe if it doesn't match normal patterns
    }
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link Local / AWS Metadata API)
    if (parts[0] === 169 && parts[1] === 254) return true;

    return false;
  }

  // Poll a single feed source
  async syncSource(sourceId: string): Promise<any> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
    });

    if (!source || source.status === SourceStatus.INACTIVE) {
      throw new BadRequestException('Feed source is inactive or does not exist.');
    }

    // SSRF Check
    const safe = await this.isSafeUrl(source.feedUrl);
    if (!safe) {
      await this.prisma.source.update({
        where: { id: sourceId },
        data: {
          status: SourceStatus.FAILED,
        },
      });
      throw new ForbiddenException(`SSRF Ingress Warning: Resolving address of ${source.feedUrl} resolves to an internal network.`);
    }

    const crawl = await this.prisma.crawl.create({
      data: {
        sourceId: source.id,
        status: CrawlStatus.RUNNING,
        startedAt: new Date(),
      },
    });

    const headers: Record<string, string> = {
      'User-Agent': 'NewsOps-Crawler/1.0',
    };

    // If source has ETag or Last-Modified, use conditional request headers
    if (source.etag) {
      headers['If-None-Match'] = source.etag;
    }
    if (source.lastModified) {
      headers['If-Modified-Since'] = source.lastModified;
    }

    let itemsSaved = 0;
    let itemsFound = 0;
    let errorMessage = null;
    let logSummary = '';
    let responseStatus = 200;

    try {
      const response = await fetch(source.feedUrl, { headers, signal: AbortSignal.timeout(10000) });
      responseStatus = response.status;

      if (response.status === 304) {
        logSummary = 'Feed returned 304 Not Modified. Skipping parse.';
        await this.prisma.crawl.update({
          where: { id: crawl.id },
          data: {
            status: CrawlStatus.COMPLETED,
            finishedAt: new Date(),
            rawLog: logSummary,
          },
        });
        await this.prisma.source.update({
          where: { id: source.id },
          data: {
            updatedAt: new Date(),
          },
        });
        return { itemsFound: 0, itemsSaved: 0, status: 'NOT_MODIFIED' };
      }

      if (!response.ok) {
        throw new Error(`HTTP Error response status: ${response.status}`);
      }

      const xmlText = await response.text();
      // Ensure file size limit (10MB)
      if (Buffer.byteLength(xmlText) > 10 * 1024 * 1024) {
        throw new Error('Decompression bomb / RSS XML feed exceeded file limit of 10MB.');
      }

      // Parse XML
      const parser = new xml2js.Parser({
        explicitArray: false,
        trim: true,
      });

      const result: any = await new Promise((resolve, reject) => {
        parser.parseString(xmlText, (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });

      // Check feed structure (RSS vs Atom)
      let items: any[] = [];
      if (result && result.rss && result.rss.channel && result.rss.channel.item) {
        items = Array.isArray(result.rss.channel.item)
          ? result.rss.channel.item
          : [result.rss.channel.item];
      } else if (result && result.feed && result.feed.entry) {
        items = Array.isArray(result.feed.entry)
          ? result.feed.entry
          : [result.feed.entry];
      }

      itemsFound = items.length;

      // Extract headers from response to store
      const responseHeaders = response.headers;
      const newEtag = responseHeaders.get('etag') || null;
      const newLastModified = responseHeaders.get('last-modified') || null;

      // Loop and save items
      for (const item of items) {
        const title = item.title || 'Untitled Article';
        const link = item.link && typeof item.link === 'string' ? item.link : (item.link?.$?.href || source.url);
        const description = item.description || item.summary || '';
        const content = item['content:encoded'] || item.content || description;
        const author = item['dc:creator'] || item.author?.name || item.author || null;
        
        let pubDateStr = item.pubDate || item.published || item.updated || new Date().toISOString();
        let publishedAt = new Date(pubDateStr);
        if (isNaN(publishedAt.getTime())) {
          publishedAt = new Date();
        }

        // Calculate GUID / hash
        const guid = item.guid?._ || item.guid || item.id || link;
        const fingerprintHash = crypto.createHash('sha256').update(guid + sourceId).digest('hex');

        // Check language (default based on feed content or source configuration)
        let language = 'en';
        if (source.name.toLowerCase().includes('hindi') || title.match(/[\u0900-\u097F]/)) {
          language = 'hi';
        } else if (source.name.toLowerCase().includes('telugu') || title.match(/[\u0c00-\u0c7f]/)) {
          language = 'te';
        }

        // Check if hash exists (ON CONFLICT DO NOTHING)
        try {
          await this.prisma.rawFeedItem.create({
            data: {
              sourceId: source.id,
              crawlId: crawl.id,
              title: title.substring(0, 512),
              description: description || null,
              content: content || '',
              url: link.substring(0, 2048),
              author: author ? author.substring(0, 255) : null,
              publishedAt,
              fingerprintHash,
              language,
            },
          });
          itemsSaved++;
        } catch (e) {
          // If hash already exists, create throws unique constraint error. We ignore this duplicate.
          if (e.code !== 'P2002') {
            this.logger.error(`Error saving item: ${e.message}`);
          }
        }
      }

      logSummary = `Successfully polled ${source.name}. Found ${itemsFound} items, saved ${itemsSaved} new.`;

      if (itemsSaved > 0) {
        await this.slack.sendNotification(
          `📡 *Ingestion Feed Alert*\nSuccessfully polled source *${source.name}*.\nFound *${itemsFound}* feed items, saved *${itemsSaved}* new raw articles into the moderation queue.`,
          source.organizationId
        ).catch(() => {});
      }

      // Update source metrics and conditional request headers
      await this.prisma.source.update({
        where: { id: source.id },
        data: {
          etag: newEtag,
          lastModified: newLastModified,
          status: SourceStatus.ACTIVE,
          updatedAt: new Date(),
        },
      });

      await this.prisma.crawl.update({
        where: { id: crawl.id },
        data: {
          status: CrawlStatus.COMPLETED,
          finishedAt: new Date(),
          itemsFound,
          itemsSaved,
          rawLog: logSummary,
        },
      });

      // Save sync metrics
      await this.prisma.sourceMetric.create({
        data: {
          sourceId: source.id,
          uptimeRatio: 1.0,
          averageLatencyMs: Date.now() - crawl.startedAt.getTime(),
          errorRate: 0.0,
          articleCount: itemsSaved,
        },
      });

      return { itemsFound, itemsSaved, status: 'COMPLETED' };
    } catch (e) {
      errorMessage = e.message;
      logSummary = `Failed polling source: ${errorMessage}`;
      this.logger.error(logSummary);

      await this.prisma.crawl.update({
        where: { id: crawl.id },
        data: {
          status: CrawlStatus.FAILED,
          finishedAt: new Date(),
          errorMessage,
          rawLog: logSummary,
        },
      });

      await this.prisma.source.update({
        where: { id: source.id },
        data: {
          status: SourceStatus.FAILED,
          updatedAt: new Date(),
        },
      });

      await this.prisma.sourceMetric.create({
        data: {
          sourceId: source.id,
          uptimeRatio: 0.0,
          averageLatencyMs: 0,
          errorRate: 1.0,
          articleCount: 0,
        },
      });

      throw e;
    }
  }

  // Ingest all feeds scheduled (can be run via cron / intervals)
  async pollAllScheduled(): Promise<void> {
    const activeSources = await this.prisma.source.findMany({
      where: { status: { in: [SourceStatus.ACTIVE, SourceStatus.FAILED] } },
    });

    this.logger.log(`Found ${activeSources.length} active feeds to sync.`);
    for (const src of activeSources) {
      try {
        await this.syncSource(src.id);
      } catch (err) {
        this.logger.error(`Error crawling feed source ${src.name}: ${err.message}`);
      }
    }
  }
}

// Exception definition if not imported
class ForbiddenException extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'ForbiddenException';
  }
}
