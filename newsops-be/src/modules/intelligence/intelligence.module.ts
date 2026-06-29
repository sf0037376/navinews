import { Module } from '@nestjs/common';
import { RssCrawlerService } from './rss-crawler.service';
import { SlackService } from './slack.service';
import { IntelligenceController } from './intelligence.controller';

@Module({
  providers: [RssCrawlerService, SlackService],
  controllers: [IntelligenceController],
  exports: [RssCrawlerService, SlackService],
})
export class IntelligenceModule {}
