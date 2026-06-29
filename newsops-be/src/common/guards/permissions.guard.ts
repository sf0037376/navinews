import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    // We expect request.tenantId and request.headers['x-organization-id']
    const orgId = request.headers['x-organization-id'] as string;

    if (!user) {
      return false;
    }

    // 1. Fetch user roles and permissions
    // If orgId is not provided, we can fetch all roles for this user under the tenant
    const userRoles = await this.prisma.userRole.findMany({
      where: {
        userId: user.id,
        ...(orgId ? { organizationId: orgId } : {}),
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    // 2. Check if user is SystemAdmin (bypass checks)
    const isAdmin = userRoles.some(ur => ur.role.name === 'SystemAdmin');
    if (isAdmin) {
      return true;
    }

    // 3. Extract and flatten permissions
    const userPermissions = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.rolePermissions) {
        if (rp.permission.actionNode) {
          userPermissions.add(rp.permission.actionNode);
        }
      }
    }

    // 4. Verify user has all required permissions
    const hasPermission = requiredPermissions.every(perm => userPermissions.has(perm));
    if (!hasPermission) {
      throw new ForbiddenException('You do not have permission to perform this action.');
    }

    return true;
  }
}
