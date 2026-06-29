import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(private readonly prisma: PrismaService) {}

  async sendNotification(text: string, orgId?: string): Promise<boolean> {
    try {
      // 1. Resolve Slack Webhook Url from database or environment
      let webhookUrl = process.env.SLACK_WEBHOOK_URL || null;

      if (!webhookUrl && orgId) {
        const org = await this.prisma.organization.findUnique({
          where: { id: orgId },
        });
        if (org?.slackWebhookUrl) {
          webhookUrl = org.slackWebhookUrl;
        }
      }

      if (!webhookUrl) {
        this.logger.log('Slack Webhook URL is not configured. Skipping notification.');
        return false;
      }

      // 2. Fire request
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`Slack API returned status ${response.status}`);
      }

      this.logger.log('Notification sent successfully to Slack channel.');
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to dispatch Slack alert notification: ${err.message}`);
      return false;
    }
  }
}
