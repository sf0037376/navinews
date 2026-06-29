import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Query,
  Headers,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AiOrchestratorService } from '../ai/ai-orchestrator.service';
import { AuditService } from '../auth/audit.service';
import { SlackService } from '../intelligence/slack.service';

@Controller('api/v1/editorial')
@UseGuards(AuthGuard, PermissionsGuard)
export class EditorialController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiOrchestratorService,
    private readonly audit: AuditService,
    private readonly slack: SlackService,
  ) {}

  // 1. Create Article Draft
  @Post('articles')
  @RequirePermission('articles:write')
  async createDraft(
    @Headers('x-tenant-id') tenantHeader: string,
    @Headers('x-organization-id') orgHeader: string,
    @Body() body: { title: string; content: string; summary?: string; categoryId?: string; categoryIds?: string[]; tags?: string[] },
    @Headers('authorization') auth: string,
    @Query('userId') qUserId?: string,
    @Req() req?: any,
  ) {
    const tenant = await this.prisma.tenant.findFirst();
    const org = await this.prisma.organization.findFirst();
    
    const tenantId = tenantHeader || tenant?.id;
    const organizationId = orgHeader || org?.id;

    if (!tenantId || !organizationId) {
      throw new BadRequestException('No tenant or organization context found.');
    }

    // Resolve author user from db
    const authorUser = await this.prisma.user.findFirst();
    const authorId = authorUser?.id;

    const slug = body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Check slug uniqueness
    const exists = await this.prisma.article.findFirst({
      where: { tenantId, slug, deletedAt: null },
    });
    if (exists) {
      throw new BadRequestException(`An article with the slug "${slug}" already exists.`);
    }

    const primaryCategoryId = body.categoryIds && body.categoryIds.length > 0
      ? body.categoryIds[0]
      : (body.categoryId || null);

    const article = await this.prisma.article.create({
      data: {
        tenantId,
        organizationId,
        title: body.title,
        slug,
        content: body.content,
        summary: body.summary || '',
        categoryId: primaryCategoryId,
        status: 'DRAFT',
        createdBy: authorId,
        articleCategories: body.categoryIds && body.categoryIds.length > 0 ? {
          create: body.categoryIds.map(catId => ({ categoryId: catId }))
        } : undefined,
      },
    });

    // Add tags if present
    if (body.tags && body.tags.length > 0) {
      for (const tagName of body.tags) {
        const slugifiedTag = tagName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        let tag = await this.prisma.tag.findFirst({
          where: { tenantId, slug: slugifiedTag, deletedAt: null },
        });
        if (!tag) {
          tag = await this.prisma.tag.create({
            data: {
              tenantId,
              name: tagName,
              slug: slugifiedTag,
            },
          });
        }
        await this.prisma.articleTag.create({
          data: {
            articleId: article.id,
            tagId: tag.id,
          },
        });
      }
    }

    await this.audit.logAction(
      'ARTICLE_DRAFT_CREATED',
      req.user?.id || null,
      req.user?.email || null,
      `Article Draft created: ${article.title} (Slug: ${article.slug})`
    );

    return article;
  }

  // 2. List all articles for workspace
  @Get('articles')
  async listArticles(
    @Query('status') status?: string,
    @Query('category') categoryId?: string,
    @Req() req?: any,
  ) {
    const where: any = { deletedAt: null };
    if (status) where.status = status;
    if (categoryId) {
      where.OR = [
        { categoryId: categoryId },
        {
          articleCategories: {
            some: {
              categoryId: categoryId,
            },
          },
        },
      ];
    }

    const user = req?.user;
    if (user) {
      const membership = await this.prisma.tenantUser.findFirst({
        where: { userId: user.id },
      });
      const roleName = membership?.customTitle || 'Subscriber';
      
      if (roleName === 'Author') {
        where.createdBy = user.id;
      }
    }

    return this.prisma.article.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        category: true,
        tags: {
          include: { tag: true },
        },
        articleCategories: {
          include: { category: true },
        },
      },
    });
  }

  // 3. Get Article details and history
  @Get('articles/:id')
  async getArticleDetails(@Param('id') id: string) {
    const article = await this.prisma.article.findUnique({
      where: { id },
      include: {
        category: true,
        revisions: { orderBy: { versionNumber: 'desc' } },
        tags: { include: { tag: true } },
        articleCategories: {
          include: { category: true },
        },
      },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Article not found.');
    }

    return article;
  }

  // 4. Update Article Draft
  @Put('articles/:id')
  @RequirePermission('articles:write')
  async updateArticle(
    @Param('id') id: string,
    @Body() body: { title: string; content: string; summary?: string; categoryId?: string; categoryIds?: string[] },
    @Req() req: any,
  ) {
    const article = await this.prisma.article.findUnique({
      where: { id },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Article not found.');
    }

    const primaryCategoryId = body.categoryIds && body.categoryIds.length > 0
      ? body.categoryIds[0]
      : (body.categoryId || null);

    // Get current category IDs in junction table
    const existingRelations = await this.prisma.articleCategory.findMany({
      where: { articleId: id },
    });
    const existingCatIds = existingRelations.map(r => r.categoryId);

    let hasCategoryChanged = false;
    if (body.categoryIds) {
      const sortedNew = [...body.categoryIds].sort();
      const sortedOld = [...existingCatIds].sort();
      hasCategoryChanged = JSON.stringify(sortedNew) !== JSON.stringify(sortedOld);
    } else if (body.categoryId) {
      hasCategoryChanged = body.categoryId !== article.categoryId;
    }

    // Category change restriction: only Admin/Editor can change category after approval (PUBLISHED)
    if (article.status === 'PUBLISHED' && hasCategoryChanged) {
      const userId = req.user?.id || req.userId;
      if (userId) {
        const userRoles = await this.prisma.userRole.findMany({
          where: { userId },
          include: { role: true },
        });
        const isAdmin = userRoles.some(ur => ur.role.name === 'SystemAdmin');
        const isEditor = userRoles.some(ur => ur.role.name === 'Editor');

        if (!isAdmin && !isEditor) {
          throw new ForbiddenException('Category changes for published articles are restricted to Administrators and Editors only.');
        }
      }
    }

    // Versioning logic: Save revision if published or under review
    if (article.status === 'PUBLISHED' || article.status === 'IN_REVIEW') {
      await this.prisma.articleRevision.create({
        data: {
          articleId: article.id,
          versionNumber: article.versionNumber,
          title: article.title,
          summary: article.summary,
          content: article.content,
          createdAt: new Date(),
        },
      });
    }

    // Update many-to-many junction categories if provided
    if (body.categoryIds) {
      await this.prisma.articleCategory.deleteMany({
        where: { articleId: id },
      });
      if (body.categoryIds.length > 0) {
        await this.prisma.articleCategory.createMany({
          data: body.categoryIds.map(catId => ({
            articleId: id,
            categoryId: catId,
          })),
        });
      }
    }

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        title: body.title,
        content: body.content,
        summary: body.summary || article.summary,
        categoryId: primaryCategoryId !== undefined ? primaryCategoryId : article.categoryId,
        versionNumber: article.versionNumber + 1,
      },
    });

    await this.audit.logAction(
      'ARTICLE_UPDATED',
      req.user?.id || null,
      req.user?.email || null,
      `Article updated: ${updated.title} (New version: v${updated.versionNumber})`
    );

    return updated;
  }

  // 5. Submit for Review or Change Status (Publish gated)
  @Put('articles/:id/status')
  async changeStatus(
    @Param('id') id: string,
    @Body() body: { status: string },
    @Headers('x-organization-id') orgHeader: string,
    @Headers('authorization') auth: string,
    @Req() req: any,
  ) {
    const article = await this.prisma.article.findUnique({
      where: { id },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Article not found.');
    }

    const newStatus = body.status.toUpperCase();
    if (newStatus === 'PUBLISHED') {
      if (!article.title || !article.title.trim()) {
        throw new BadRequestException('Headline Title is required before publishing.');
      }
      if (!article.summary || !article.summary.trim()) {
        throw new BadRequestException('Sub-heading (SEO summary) is required before publishing.');
      }
      if (!article.content || !article.content.trim()) {
        throw new BadRequestException('Article Body Content is required before publishing.');
      }
      if (!article.categoryId) {
        throw new BadRequestException('Category selection is required before publishing.');
      }

      // 1. Fetch user roles under organization to check permissions
      const userId = req.user?.id || req.userId;
      const org = await this.prisma.organization.findFirst();
      const organizationId = orgHeader || org?.id;

      if (userId && organizationId) {
        const userRoles = await this.prisma.userRole.findMany({
          where: { userId, organizationId },
          include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
        });

        const isAdmin = userRoles.some(ur => ur.role.name === 'SystemAdmin');
        const isEditor = userRoles.some(ur => ur.role.name === 'Editor');
        const hasPublishPermission = userRoles.some(ur =>
          ur.role.rolePermissions.some(rp => rp.permission.actionNode === 'articles:publish'),
        );

        if (!isAdmin && !isEditor && !hasPublishPermission) {
          throw new ForbiddenException('Authors require approval to publish articles. Submitting to review queue.');
        }

        // Rule: Only verified ones can be published by editor, admin can publish any article irrespective of verification status
        if (isEditor && !isAdmin) {
          if (article.aiVeracityStatus !== 'VERIFIED') {
            throw new BadRequestException('Forbidden: Editors can only publish articles that are verified by AI.');
          }
        }
      }
    }

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        status: newStatus,
        ...(newStatus === 'PUBLISHED' ? { publishedAt: new Date() } : {}),
      },
    });

    await this.audit.logAction(
      'ARTICLE_STATUS_CHANGED',
      req.user?.id || null,
      req.user?.email || null,
      `Article "${updated.title}" status changed to ${newStatus}`
    );

    await this.slack.sendNotification(
      `✍️ *Editorial Action*\nArticle *"${updated.title}"* status updated to *${newStatus}* by editorial team.`,
      updated.organizationId
    ).catch(() => {});

    return updated;
  }

  // Soft-delete draft articles
  @Delete('articles/:id')
  @RequirePermission('articles:write')
  async deleteArticle(
    @Param('id') id: string,
    @Req() req: any,
  ) {
    const article = await this.prisma.article.findUnique({
      where: { id },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Article not found.');
    }

    if (article.status !== 'DRAFT') {
      throw new BadRequestException('Only articles in DRAFT status can be deleted.');
    }

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });

    await this.audit.logAction(
      'ARTICLE_DELETED',
      req.user?.id || null,
      req.user?.email || null,
      `Article deleted: ${updated.title}`
    );

    return { success: true };
  }

  // 6. Content Moderator flow: Generate AI article from cluster
  @Post('articles/generate-from-cluster')
  @RequirePermission('sources:manage') // Content-moderators can access this flow
  async generateFromCluster(
    @Headers('x-tenant-id') tenantHeader: string,
    @Headers('x-organization-id') orgHeader: string,
    @Body() body: { clusterId: string },
  ) {
    const tenant = await this.prisma.tenant.findFirst();
    const org = await this.prisma.organization.findFirst();
    
    const tenantId = tenantHeader || tenant?.id;
    const organizationId = orgHeader || org?.id;

    if (!tenantId || !organizationId) {
      throw new BadRequestException('No tenant or organization context found.');
    }

    const cluster = await this.prisma.cluster.findUnique({
      where: { id: body.clusterId },
      include: {
        articles: {
          include: {
            rawFeedItem: true,
          },
        },
      },
    });

    if (!cluster) {
      throw new NotFoundException('Topic cluster not found.');
    }

    // Aggregate contents of raw feed items in the cluster
    const contextText = cluster.articles.map(a => `Source Title: ${a.rawFeedItem.title}\nSource Content: ${a.rawFeedItem.content}`).join('\n\n');

    // Generate main article in English
    const generated = await this.ai.generateArticle(
      `Write a comprehensive news article summarizing the event: "${cluster.title}". Outline context and key takeaways.`,
      contextText,
    );

    // Generate thumbnail cover image prompt & get URL
    const thumb = await this.ai.generateThumbnailPrompt(generated.title, generated.summary);
    const encodedPrompt = encodeURIComponent(thumb.prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`;
    const imageHtml = `<p><img src="${imageUrl}" alt="${thumb.altText}" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block animate-fadein" /></p>`;
    const finalEnglishContent = imageHtml + generated.content;

    // Save as draft
    const slug = generated.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const article = await this.prisma.article.create({
      data: {
        tenantId,
        organizationId,
        title: generated.title,
        slug,
        content: finalEnglishContent,
        summary: generated.summary,
        status: 'DRAFT',
      },
    });

    // Translate to Telugu and Hindi
    const teluguTranslation = await this.ai.translateText(generated.content, 'te');
    const teluguTitle = await this.ai.translateText(generated.title, 'te');
    const teluguSummary = await this.ai.translateText(generated.summary, 'te');
    const teluguContentFinal = imageHtml + teluguTranslation;

    const hindiTranslation = await this.ai.translateText(generated.content, 'hi');
    const hindiTitle = await this.ai.translateText(generated.title, 'hi');
    const hindiSummary = await this.ai.translateText(generated.summary, 'hi');
    const hindiContentFinal = imageHtml + hindiTranslation;

    // Save translated draft versions
    const teluguSlug = `${slug}-te`;
    await this.prisma.article.create({
      data: {
        tenantId,
        organizationId,
        title: teluguTitle,
        slug: teluguSlug,
        content: teluguContentFinal,
        summary: teluguSummary,
        status: 'DRAFT',
      },
    });

    const hindiSlug = `${slug}-hi`;
    await this.prisma.article.create({
      data: {
        tenantId,
        organizationId,
        title: hindiTitle,
        slug: hindiSlug,
        content: hindiContentFinal,
        summary: hindiSummary,
        status: 'DRAFT',
      },
    });

    return {
      message: 'Articles generated in English, Telugu, and Hindi successfully!',
      englishArticleId: article.id,
      teluguSlug,
      hindiSlug,
    };
  }

  // 6.b Generate AI article from raw feed item (Moderator Approved Action)
  @Post('articles/generate-from-raw')
  @RequirePermission('sources:manage')
  async generateFromRaw(
    @Headers('x-tenant-id') tenantHeader: string,
    @Headers('x-organization-id') orgHeader: string,
    @Body() body: { rawItemId: string; languages?: string[] },
    @Req() req: any,
  ) {
    const tenant = await this.prisma.tenant.findFirst();
    const org = await this.prisma.organization.findFirst();
    
    const tenantId = tenantHeader || tenant?.id;
    const organizationId = orgHeader || org?.id;

    if (!tenantId || !organizationId) {
      throw new BadRequestException('No tenant or organization context found.');
    }

    const rawItem = await this.prisma.rawFeedItem.findUnique({
      where: { id: body.rawItemId },
    });

    if (!rawItem) {
      throw new NotFoundException('Ingested raw feed item not found.');
    }

    // 1. Notify Slack of approve for AI processing
    await this.slack.sendNotification(
      `🤖 *Moderator Action*\nIngested article *"${rawItem.title}"* approved for AI content generation.`,
      organizationId
    ).catch(() => {});

    // Scrape the full article text from the URL if present, to use as context
    let scrapeContext = rawItem.content || rawItem.description || '';
    if (rawItem.url) {
      try {
        const fetchRes = await fetch(rawItem.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (fetchRes.ok) {
          const rawHtml = await fetchRes.text();
          const pMatches = [...rawHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
          const paragraphs = pMatches
            .map(m => m[1].replace(/<[^>]*>/g, '').trim())
            .filter(text => text.length > 35)
            .slice(0, 15);
          if (paragraphs.length > 0) {
            scrapeContext = paragraphs.join('\n');
          }
        }
      } catch (err) {
        // Fallback silently to rawItem.content
      }
    }

    // 2. Generate article content using AI
    const generated = await this.ai.generateArticle(
      `Write a complete, highly-engaging news article matching original report title: "${rawItem.title}". Outline context details.`,
      scrapeContext
    );

    const slug = generated.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const exists = await this.prisma.article.findFirst({
      where: { tenantId, slug, deletedAt: null },
    });
    const finalSlug = exists ? `${slug}-${Date.now().toString().slice(-4)}` : slug;

    // Verify news authenticity automatically upon raw ingestion approval
    const veracity = await this.ai.verifyArticleVeracity(generated.title, generated.content);

    // Generate thumbnail cover image prompt & get URL
    const thumb = await this.ai.generateThumbnailPrompt(generated.title, generated.summary);
    const encodedPrompt = encodeURIComponent(thumb.prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=800&height=450&nologo=true`;
    const imageHtml = `<p><img src="${imageUrl}" alt="${thumb.altText}" class="my-4 rounded-xl max-w-full shadow-lg border-2 border-primary/20 block animate-fadein" /></p>`;
    const finalEnglishContent = imageHtml + generated.content;

    // Create English draft
    const article = await this.prisma.article.create({
      data: {
        tenantId,
        organizationId,
        title: generated.title,
        slug: finalSlug,
        content: finalEnglishContent,
        summary: generated.summary,
        status: 'DRAFT',
        aiVeracityStatus: veracity.veracityStatus,
        aiExplanation: veracity.explanation,
      },
    });

    // Translate to dynamic languages
    const targetLangs = body.languages || ['te', 'hi'];
    const translationsCreated = [];

    for (const lang of targetLangs) {
      const translatedContent = await this.ai.translateText(generated.content, lang as any);
      const translatedTitle = await this.ai.translateText(generated.title, lang as any);
      const translatedSummary = await this.ai.translateText(generated.summary, lang as any);
      
      const langSlug = `${finalSlug}-${lang}`;
      
      // Prepend the same thumbnail image HTML block to the dynamic language content
      const finalLangContent = imageHtml + translatedContent;

      const translatedArticle = await this.prisma.article.create({
        data: {
          tenantId,
          organizationId,
          title: translatedTitle,
          slug: langSlug,
          content: finalLangContent,
          summary: translatedSummary,
          status: 'DRAFT',
        },
      });
      translationsCreated.push({ language: lang, id: translatedArticle.id, slug: langSlug });
    }

    await this.audit.logAction(
      'AI_ARTICLE_GENERATED',
      req.user?.id || null,
      req.user?.email || null,
      `AI Article draft created from raw feed: ${article.title} with translations: ${targetLangs.join(', ')}`
    );

    await this.slack.sendNotification(
      `✨ *AI Generation Complete*\nDraft articles created in *English* (id: ${article.id}) and translations for: *${targetLangs.join(', ').toUpperCase()}*.`,
      organizationId
    ).catch(() => {});

    return {
      message: 'AI draft articles created successfully from raw feed item!',
      englishArticleId: article.id,
      slug: finalSlug,
      translations: translationsCreated,
    };
  }

  // 6.c Translate any article draft to any target language dynamically
  @Post('articles/:id/translate')
  @RequirePermission('articles:write')
  async translateArticle(
    @Param('id') id: string,
    @Body() body: { targetLang: string },
    @Req() req: any,
  ) {
    const article = await this.prisma.article.findUnique({
      where: { id },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Source article draft not found.');
    }

    const target = body.targetLang.toLowerCase();
    
    // Call AI translator
    const cleanTitle = article.title.replace(/^\[[A-Z]+\]\s*/i, '');
    const cleanSummary = (article.summary || '').replace(/^\[[A-Z]+\]\s*/i, '');

    const translatedContent = await this.ai.translateText(article.content, target as any);
    const translatedTitle = await this.ai.translateText(cleanTitle, target as any);
    const translatedSummary = cleanSummary ? await this.ai.translateText(cleanSummary, target as any) : '';
    
    const slugSuffix = `-${target}`;
    
    const baseSlug = article.slug.split('-')[0];
    const exists = await this.prisma.article.findFirst({
      where: { tenantId: article.tenantId, slug: `${baseSlug}${slugSuffix}`, deletedAt: null },
    });
    const finalSlug = exists ? `${baseSlug}${slugSuffix}-${Date.now().toString().slice(-4)}` : `${baseSlug}${slugSuffix}`;

    const translatedArticle = await this.prisma.article.create({
      data: {
        tenantId: article.tenantId,
        organizationId: article.organizationId,
        title: translatedTitle,
        slug: finalSlug,
        content: translatedContent,
        summary: translatedSummary,
        status: 'DRAFT',
        categoryId: article.categoryId,
      },
    });

    await this.audit.logAction(
      'ARTICLE_TRANSLATED',
      req.user?.id || null,
      req.user?.email || null,
      `Article "${article.title}" translated to ${target.toUpperCase()} (New slug: ${finalSlug})`
    );

    return {
      message: `Successfully translated article to ${target.toUpperCase()}!`,
      article: translatedArticle,
    };
  }

  // 6.d Generate AI article content, SEO summaries, and thumbnail prompts
  @Post('articles/generate-ai-data')
  async generateAiData(
    @Body() body: { title: string; summary?: string },
  ) {
    if (!body.title) {
      throw new BadRequestException('Title is required to generate AI content.');
    }

    const generated = await this.ai.generateArticle(
      `Write a complete, highly-engaging news article matching original report title: "${body.title}".`,
      body.summary || ''
    );

    const thumb = await this.ai.generateThumbnailPrompt(generated.title, generated.summary);

    return {
      title: generated.title,
      summary: generated.summary,
      content: generated.content,
      thumbnailPrompt: thumb.prompt,
      thumbnailAlt: thumb.altText,
    };
  }

  // 6.e Import external news article from a URL
  @Post('articles/import-url')
  async importFromUrl(
    @Headers('x-tenant-id') tenantHeader: string,
    @Headers('x-organization-id') orgHeader: string,
    @Body() body: { url: string },
    @Req() req: any,
  ) {
    if (!body.url) {
      throw new BadRequestException('URL is required.');
    }

    const tenant = await this.prisma.tenant.findFirst();
    const org = await this.prisma.organization.findFirst();
    
    const tenantId = tenantHeader || tenant?.id;
    const organizationId = orgHeader || org?.id;

    if (!tenantId || !organizationId) {
      throw new BadRequestException('No tenant or organization context found.');
    }

    try {
      const response = await fetch(body.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }
      const rawHtml = await response.text();

      // Scrape basic headline title
      let parsedTitle = '';
      const titleMatch = rawHtml.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        parsedTitle = titleMatch[1].trim().replace(/\s+/g, ' ');
      }
      if (!parsedTitle) {
        const h1Match = rawHtml.match(/<h1>(.*?)<\/h1>/i);
        parsedTitle = h1Match && h1Match[1] ? h1Match[1].trim() : 'Scraped News Article';
      }

      // Scrape subheadings/H2 as summary fallback
      let parsedSubheading = '';
      const h2Match = rawHtml.match(/<h2>(.*?)<\/h2>/i);
      if (h2Match && h2Match[1]) {
        parsedSubheading = h2Match[1].trim().replace(/\s+/g, ' ');
      }

      // Collect paragraphs
      const pMatches = [...rawHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
      let paragraphs = pMatches
        .map(m => m[1].replace(/<[^>]*>/g, '').trim())
        .filter(text => text.length > 35)
        .slice(0, 15);

      if (paragraphs.length === 0) {
        paragraphs = ['No substantive news text could be raw-scraped. Please click the Puter.js AI button in your operations editor to generate and format this article body automatically.'];
      }

      const bodyHtml = paragraphs.map(p => `<p>${p}</p>`).join('\n');
      const sourceRefHtml = `<p className="mt-8 pt-4 border-t border-border text-[10px] text-muted-foreground font-mono">Source Reference: <a href="${body.url}" target="_blank" className="text-primary underline hover:text-primary/95">${body.url}</a></p>`;
      const finalContent = bodyHtml + '\n' + sourceRefHtml;

      const slug = parsedTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').substring(0, 120);
      const exists = await this.prisma.article.findFirst({
        where: { tenantId, slug, deletedAt: null },
      });
      const finalSlug = exists ? `${slug}-${Date.now().toString().slice(-4)}` : slug;

      const article = await this.prisma.article.create({
        data: {
          tenantId,
          organizationId,
          title: parsedTitle,
          slug: finalSlug,
          summary: parsedSubheading.substring(0, 250) || 'Raw scraped external draft.',
          content: finalContent,
          status: 'DRAFT',
        },
      });

      await this.audit.logAction(
        'ARTICLE_IMPORTED_RAW',
        req.user?.id || null,
        req.user?.email || null,
        `Raw news article draft imported from URL: ${body.url}`
      );

      return {
        message: 'Successfully imported raw news draft from URL!',
        article,
      };
    } catch (err: any) {
      throw new BadRequestException(`Failed to import article from URL: ${err.message}`);
    }
  }

  // 7. Categories management
  @Get('categories')
  async getCategories() {
    return this.prisma.category.findMany({
      where: { deletedAt: null },
      include: { parent: true },
    });
  }

  @Post('categories')
  @RequirePermission('taxonomy:manage')
  async createCategory(
    @Headers('x-tenant-id') tenantHeader: string,
    @Body() body: { name: string; description?: string; parentId?: string },
  ) {
    const tenant = await this.prisma.tenant.findFirst();
    const tenantId = tenantHeader || tenant?.id;

    if (!tenantId) {
      throw new BadRequestException('No tenant context found.');
    }

    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return this.prisma.category.create({
      data: {
        tenantId,
        name: body.name,
        slug,
        description: body.description || '',
        parentId: body.parentId || null,
      },
    });
  }

  // AI generation endpoint with Pollinations -> NVIDIA NIM -> Puter.js (client fallback)
  @Post('articles/ai-fallback')
  async aiFallback(@Body() body: { prompt: string }) {
    if (!body.prompt) {
      throw new BadRequestException('Prompt is required.');
    }

    // Priority 1: Pollinations (using backend API)
    try {
      const result = await this.ai.callPollinations(
        'You are a professional assistant. Do not wrap the JSON output in markdown tags or add extra notes.',
        body.prompt
      );
      if (result && result.trim().length > 0) {
        return { result };
      }
    } catch (err: any) {
      console.warn(`Pollinations backend call failed: ${err.message || err}. Falling back to NVIDIA NIM...`);
    }

    // Priority 2: NVIDIA NIM (using backend API)
    try {
      const result = await this.ai.callNvidiaNim(body.prompt);
      if (result && result.trim().length > 0) {
        return { result };
      }
    } catch (err: any) {
      throw new BadRequestException(`NVIDIA NIM fallback failed: ${err.message || err}`);
    }

    throw new BadRequestException('No backend AI providers returned a valid response.');
  }

  @Post('articles/:id/verify-authenticity')
  async verifyAuthenticity(@Param('id') id: string) {
    const article = await this.prisma.article.findUnique({
      where: { id },
    });

    if (!article || article.deletedAt) {
      throw new NotFoundException('Article not found.');
    }

    const veracity = await this.ai.verifyArticleVeracity(article.title, article.content);

    const updated = await this.prisma.article.update({
      where: { id },
      data: {
        aiVeracityStatus: veracity.veracityStatus,
        aiExplanation: veracity.explanation,
      },
    });

    return updated;
  }
}
