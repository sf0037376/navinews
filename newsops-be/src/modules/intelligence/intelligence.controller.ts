import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Query,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RssCrawlerService } from './rss-crawler.service';
import { PrismaService } from '../prisma/prisma.service';
import { SourceType } from '@prisma/client';

@Controller('api/v1/intelligence')
export class IntelligenceController {
  constructor(
    private readonly crawler: RssCrawlerService,
    private readonly prisma: PrismaService,
  ) {}

  // 1. Register a Monitored RSS Feed
  @Post('sources')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('sources:manage')
  async createSource(
    @Headers('x-organization-id') orgId: string,
    @Body() body: { name: string; url: string; feedUrl: string; pollingIntervalMinutes?: number; cronExpression?: string },
  ) {
    // Default organization link
    const organizationId = orgId || (await this.prisma.organization.findFirst())?.id;
    if (!organizationId) {
      throw new Error('No organization context provided.');
    }

    return this.prisma.source.create({
      data: {
        organizationId,
        name: body.name,
        url: body.url,
        feedUrl: body.feedUrl,
        type: SourceType.RSS,
        cronExpression: body.cronExpression || `*/15 * * * *`,
      },
    });
  }

  // 2. Fetch all Ingestion Sources
  @Get('sources')
  async getSources() {
    return this.prisma.source.findMany({
      include: {
        sourceMetrics: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });
  }

  // 3. Force Immediate Feed Sync
  @Post('sources/:id/sync')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('sources:manage')
  @HttpCode(200)
  async forceSync(@Param('id') id: string) {
    const result = await this.crawler.syncSource(id);
    return {
      sourceId: id,
      ...result,
    };
  }

  // 4. Fetch Feed Diagnostics Dashboard Data
  @Get('sources/diagnostics')
  async getDiagnostics() {
    const sources = await this.prisma.source.findMany();
    const active = sources.filter(s => s.status === 'ACTIVE').length;
    const failed = sources.filter(s => s.status === 'FAILED').length;
    const rateLimited = sources.filter(s => s.status === 'RATE_LIMITED').length;

    // Get recent failures
    const recentFailures = await this.prisma.crawl.findMany({
      where: { status: 'FAILED' },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { source: true },
    });

    return {
      summary: {
        totalFeeds: sources.length,
        activeFeeds: active,
        degradedFeeds: rateLimited,
        disabledFeeds: failed,
      },
      failures: recentFailures.map(f => ({
        feedId: f.sourceId,
        name: f.source.name,
        url: f.source.feedUrl,
        errorCode: 'CRAWL_FAILED',
        lastAttemptAt: f.startedAt,
        consecutiveFailures: f.source.status === 'FAILED' ? 1 : 0,
        errorMessage: f.errorMessage,
      })),
    };
  }

  // 5. Get Ingested Raw Items
  @Get('raw-items')
  async getRawItems(
    @Query('page') page = '1',
    @Query('limit') limit = '20',
    @Query('language') language?: string,
  ) {
    const p = parseInt(page, 10) || 1;
    const l = parseInt(limit, 10) || 20;

    const where = language ? { language } : {};

    const [total, data] = await Promise.all([
      this.prisma.rawFeedItem.count({ where }),
      this.prisma.rawFeedItem.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        include: { source: true },
      }),
    ]);

    return {
      data,
      pagination: {
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l),
      },
    };
  }

  // 6. Get Article Clusters
  @Get('clusters')
  async getClusters(
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('category') category?: string,
  ) {
    const p = parseInt(page, 10) || 1;
    const l = parseInt(limit, 10) || 10;

    const where = category ? { category, deletedAt: null } : { deletedAt: null };

    const [total, data] = await Promise.all([
      this.prisma.cluster.count({ where }),
      this.prisma.cluster.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * l,
        take: l,
        include: {
          articles: {
            include: {
              rawFeedItem: true,
            },
          },
        },
      }),
    ]);

    return {
      data: data.map(c => ({
        id: c.id,
        title: c.title,
        summary: c.summary,
        representativeEntity: c.representativeEntity,
        category: c.category,
        status: c.status,
        articleCount: c.articles.length,
        createdAt: c.createdAt,
      })),
      pagination: {
        total,
        page: p,
        limit: l,
        totalPages: Math.ceil(total / l),
      },
    };
  }
}
