import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logAction(
    action: string,
    userId: string | null,
    userEmail: string | null,
    details?: string,
  ): Promise<any> {
    try {
      this.logger.log(`[AUDIT LOG] Action: ${action} | User: ${userEmail || 'System/Anonymous'}`);

      return await this.prisma.auditLog.create({
        data: {
          userId,
          userEmail,
          action,
          details: details || null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Failed to write audit log: ${err.message}`);
      return null;
    }
  }
}
