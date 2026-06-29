import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  UseGuards,
  Headers,
  BadRequestException,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/v1/editorial')
export class CommentsController {
  constructor(private readonly prisma: PrismaService) {}

  // 1. Get nested comment tree for an article
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

    // Structure nested list tree in JavaScript
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

  // 2. Add Comment (gated by AuthGuard/Subscriber status)
  @Post('articles/:articleId/comments')
  @UseGuards(AuthGuard)
  async createComment(
    @Param('articleId') articleId: string,
    @Headers('x-tenant-id') tenantHeader: string,
    @Body() body: { content: string; parentId?: string },
    @Headers('authorization') auth: string,
    @Query('userId') queryUserId?: string,
  ) {
    // In our simplified auth setup, the AuthGuard attaches request.user.
    // The user must be active.
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

    // Resolve user details
    const user = await this.prisma.user.findFirst();
    const userId = user?.id;

    return this.prisma.comment.create({
      data: {
        tenantId,
        articleId,
        parentId: body.parentId || null,
        userId,
        authorName: user ? `${user.firstName} ${user.lastName}` : 'Anonymous',
        authorEmail: user ? user.email : 'anon@newsops.cloud',
        content: body.content,
        moderationStatus: 'APPROVED', // Auto-approve comments for Phase 1 MVP unless reported
      },
    });
  }

  // 3. Moderate Comments (Approve / Reject)
  @Put('comments/:id/moderate')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('comments:moderate')
  async moderateComment(
    @Param('id') id: string,
    @Body() body: { status: 'APPROVED' | 'REJECTED' | 'FLAGGED' },
  ) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
    });
    if (!comment || comment.deletedAt) {
      throw new NotFoundException('Comment not found.');
    }

    return this.prisma.comment.update({
      where: { id },
      data: {
        moderationStatus: body.status,
      },
    });
  }

  // 4. Moderate Queue list
  @Get('comments/moderation-queue')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('comments:moderate')
  async getModerationQueue() {
    return this.prisma.comment.findMany({
      where: {
        moderationStatus: 'PENDING',
        deletedAt: null,
      },
      include: {
        article: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
