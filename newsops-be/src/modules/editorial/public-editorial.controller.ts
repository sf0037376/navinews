import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Headers,
  BadRequestException,
  NotFoundException,
  Query,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';

@Controller('api/v1/public')
export class PublicEditorialController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiOrchestratorService,
  ) {}

  // 1. Get published articles
  @Get('articles')
  async getPublishedArticles(
    @Query('q') query?: string,
    @Query('category') categoryName?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const where: any = {
      status: 'PUBLISHED',
      deletedAt: null,
    };

    if (categoryName && categoryName !== 'All') {
      where.category = { name: categoryName };
    }

    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ];
    }

    const take = limit ? parseInt(limit, 10) : undefined;
    const skip = offset ? parseInt(offset, 10) : undefined;

    const articles = await this.prisma.article.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take,
      skip,
      include: {
        category: true,
        tags: {
          include: { tag: true },
        },
      },
    });

    return articles.map(art => {
      const match = art.content.match(/<img[^>]+src=["']([^"']+)["']/i);
      return {
        id: art.id,
        title: art.title,
        slug: art.slug,
        summary: art.summary,
        status: art.status,
        publishedAt: art.publishedAt,
        category: art.category,
        coverImage: match ? match[1] : null,
      };
    });
  }

  // 2. Get single article by slug
  @Get('articles/:slug')
  async getArticleBySlug(@Param('slug') slug: string) {
    const article = await this.prisma.article.findFirst({
      where: { slug, status: 'PUBLISHED', deletedAt: null },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    if (!article) {
      throw new NotFoundException('Article not found.');
    }

    return article;
  }

  // 3. Get article comments
  @Get('articles/:articleId/comments')
  async getComments(@Param('articleId') articleId: string) {
    const comments = await this.prisma.comment.findMany({
      where: {
        articleId,
        moderationStatus: 'APPROVED',
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });

    const map = new Map<string, any>();
    const roots: any[] = [];

    comments.forEach(c => {
      map.set(c.id, { ...c, replies: [] });
    });

    comments.forEach(c => {
      const mapped = map.get(c.id);
      if (c.parentId && map.has(c.parentId)) {
        map.get(c.parentId).replies.push(mapped);
      } else {
        roots.push(mapped);
      }
    });

    return roots;
  }

  // 4. Create comment (subscriber login)
  @Post('articles/:articleId/comments')
  @UseGuards(AuthGuard)
  async createComment(
    @Param('articleId') articleId: string,
    @Headers('x-tenant-id') tenantHeader: string,
    @Body() body: { content: string; parentId?: string },
    @Req() req: any,
  ) {
    const tenant = await this.prisma.tenant.findFirst();
    const tenantId = tenantHeader || tenant?.id;

    if (!tenantId) {
      throw new BadRequestException('No tenant context found.');
    }

    const article = await this.prisma.article.findUnique({
      where: { id: articleId },
    });
    if (!article || article.deletedAt) {
      throw new NotFoundException('Article not found.');
    }

    const user = req.user;

    return this.prisma.comment.create({
      data: {
        tenantId,
        articleId,
        parentId: body.parentId || null,
        userId: user.id,
        authorName: `${user.firstName} ${user.lastName}`,
        authorEmail: user.email,
        content: body.content,
        moderationStatus: 'APPROVED',
      },
    });
  }

  // 5. Dynamic translation on-demand for reader portal
  @Post('articles/:id/translate')
  async translateArticle(
    @Param('id') id: string,
    @Body() body: { targetLang: string },
  ) {
    const article = await this.prisma.article.findUnique({
      where: { id },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Source article not found.');
    }

    const target = body.targetLang.toLowerCase();
    
    // Check if it already exists to avoid redundant calls
    const baseSlug = article.slug.split('-')[0];
    const exists = await this.prisma.article.findFirst({
      where: { tenantId: article.tenantId, slug: `${baseSlug}-${target}`, deletedAt: null },
    });

    if (exists) {
      return { article: exists };
    }

    const translatedContent = await this.ai.translateText(article.content, target as any);
    const translatedTitle = `[${target.toUpperCase()}] ${article.title.replace(/^\[[A-Z]+\]\s*/i, '')}`;
    const targetSlug = `${baseSlug}-${target}`;

    const translatedArticle = await this.prisma.article.create({
      data: {
        tenantId: article.tenantId,
        organizationId: article.organizationId,
        title: translatedTitle,
        slug: targetSlug,
        content: translatedContent,
        summary: `[${target.toUpperCase()}] ${article.summary || ''}`,
        status: 'PUBLISHED', // Dynamic reader translation is auto-published
        categoryId: article.categoryId,
        publishedAt: new Date(),
      },
    });

    return {
      message: 'Article translated and published successfully',
      article: translatedArticle,
    };
  }
}
