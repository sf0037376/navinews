import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authentication token.');
    }

    const token = authHeader.split(' ')[1];
    
    // Developer/staging bypass for mock token — works even on empty DB
    if (token === 'mock_admin_token') {
      // Try to find a real user first
      const user = await this.prisma.user.findFirst({
        where: { deletedAt: null, status: 'ACTIVE' },
      });
      if (user) {
        request.user = user;
        request.userId = user.id;
        return true;
      }
      // No users yet (fresh DB) — use a synthetic admin stub so seed routes work
      const tenant = await this.prisma.tenant.findFirst();
      const org = await this.prisma.organization.findFirst();
      const syntheticAdmin = {
        id: 'mock-admin-id',
        email: 'admin@newsops.cloud',
        firstName: 'Admin',
        lastName: 'User',
        role: 'ADMIN',
        status: 'ACTIVE',
        tenantId: tenant?.id ?? 'mock-tenant-id',
        organizationId: org?.id ?? 'mock-org-id',
        deletedAt: null,
      };
      request.user = syntheticAdmin;
      request.userId = syntheticAdmin.id;
      return true;
    }

    try {
      const secret = process.env.JWT_SECRET || 'newsops_phase1_super_secret_key';
      const decoded = jwt.verify(token, secret) as { userId: string; email: string };

      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId, deletedAt: null },
      });

      if (!user || user.status !== 'ACTIVE') {
        throw new UnauthorizedException('User is suspended or does not exist.');
      }

      request.user = user;
      request.userId = user.id;

      return true;
    } catch (err) {
      throw new UnauthorizedException('Missing or invalid authentication token.');
    }
  }
}
