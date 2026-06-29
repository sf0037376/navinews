import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  NotFoundException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../modules/prisma/prisma.service';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    
    // 1. Extract tenant identifier from headers or subdomain
    let tenantId = request.headers['x-tenant-id'] as string;
    let subdomain = '';

    if (!tenantId) {
      const host = request.headers.host || '';
      const parts = host.split('.');
      if (parts.length > 2) {
        // e.g. tenant1.newsops.local -> tenant1
        subdomain = parts[0];
      }
    }

    // 2. Resolve tenant
    let tenant = null;
    if (tenantId) {
      tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId, deletedAt: null },
      });
    } else if (subdomain && subdomain !== 'www' && subdomain !== 'admin') {
      tenant = await this.prisma.tenant.findFirst({
        where: { subdomain, deletedAt: null },
      });
    }

    // 3. For tenant-scoped routes, enforce check (if not a global route)
    const url = request.url;
    const isGlobalRoute = url.startsWith('/api/v1/admin/tenants') || url.startsWith('/auth/login') || url.startsWith('/auth/register');

    if (!tenant && !isGlobalRoute && (tenantId || subdomain)) {
      throw new NotFoundException('The requested workspace does not exist or has been suspended.');
    }

    // 4. Attach context to request
    if (tenant) {
      request.tenant = tenant;
      request.tenantId = tenant.id;
    } else {
      // Use a default tenant if one exists in the DB for ease of development/testing
      const defaultTenant = await this.prisma.tenant.findFirst({ where: { deletedAt: null } });
      if (defaultTenant) {
        request.tenant = defaultTenant;
        request.tenantId = defaultTenant.id;
      }
    }

    return next.handle();
  }
}
