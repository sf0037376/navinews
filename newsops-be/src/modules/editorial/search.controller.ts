import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('api/v1/search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async searchArticles(
    @Query('q') query: string,
    @Query('language') language?: string,
  ) {
    if (!query) {
      throw new BadRequestException('Search query is required.');
    }

    const where: any = {
      status: 'PUBLISHED',
      deletedAt: null,
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
        { summary: { contains: query, mode: 'insensitive' } },
      ],
    };

    if (language) {
      // In the intelligence schema, language is on RawFeedItem, but on Article we can assume language matches
      // or filter based on a title suffix/language query or match.
      // Let's implement basic filtering by title prefix for [HINDI] / [TELUGU] or matching titles
      if (language === 'hi') {
        where.title = { contains: '[HINDI]', mode: 'insensitive' };
      } else if (language === 'te') {
        where.title = { contains: '[TELUGU]', mode: 'insensitive' };
      } else {
        // English
        where.NOT = [
          { title: { contains: '[HINDI]', mode: 'insensitive' } },
          { title: { contains: '[TELUGU]', mode: 'insensitive' } },
        ];
      }
    }

    const results = await this.prisma.article.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      include: {
        category: true,
        tags: { include: { tag: true } },
      },
    });

    return results;
  }
}
