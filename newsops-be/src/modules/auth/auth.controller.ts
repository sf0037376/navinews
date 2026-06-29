import { Controller, Post, Get, Body, BadRequestException, UnauthorizedException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from './audit.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';

function hashPassword(password: string): string {
  const salt = 'newsops_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post('login')
  async login(@Body() body: { email: string; password?: string }) {
    if (!body.email) {
      throw new BadRequestException('Email is required.');
    }

    const user = await this.prisma.user.findFirst({
      where: { email: body.email, deletedAt: null },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Invalid email or password.');
    }

    // Check password if provided, or default verify in sandbox
    if (body.password) {
      const hashed = hashPassword(body.password);
      if (user.passwordHash !== hashed) {
        throw new UnauthorizedException('Invalid email or password.');
      }
    }

    // Resolve tenant user membership organization
    const membership = await this.prisma.tenantUser.findFirst({
      where: { userId: user.id },
      include: { tenant: true, organization: true },
    });

    const secret = process.env.JWT_SECRET || 'newsops_phase1_super_secret_key';
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        tenantId: membership?.tenantId || null,
        organizationId: membership?.organizationId || null,
      },
      secret,
      { expiresIn: '7d' },
    );

    await this.audit.logAction(
      'USER_LOGIN',
      user.id,
      user.email,
      `User login successful (Title: ${membership?.customTitle || 'Subscriber'})`
    );

    return {
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        title: membership?.customTitle || 'Subscriber',
        tenantId: membership?.tenantId || null,
        organizationId: membership?.organizationId || null,
      },
    };
  }

  @Post('register')
  async register(
    @Body() body: { email: string; password?: string; firstName: string; lastName: string; phone?: string; address?: string; aadhaarNo?: string; roleName?: string },
  ) {
    const exists = await this.prisma.user.findFirst({
      where: { email: body.email, deletedAt: null },
    });
    if (exists) {
      throw new BadRequestException('Email is already registered.');
    }

    const passwordHash = hashPassword(body.password || 'password123');

    // Fetch default Tenant & Org to link
    const tenant = await this.prisma.tenant.findFirst();
    const org = await this.prisma.organization.findFirst();

    if (!tenant || !org) {
      throw new BadRequestException('Database not fully seeded. Missing base tenant structure.');
    }

    const user = await this.prisma.user.create({
      data: {
        email: body.email,
        passwordHash,
        firstName: body.firstName,
        lastName: body.lastName,
        status: 'ACTIVE',
        phone: body.phone || null,
        address: body.address || null,
        aadhaarNo: body.aadhaarNo || null,
      },
    });

    // Check requested role, default CustomTitle
    let customTitle = 'Reader Subscriber';
    if (body.roleName === 'Author') {
      customTitle = 'Author';
    } else if (body.roleName === 'ContentModerator' || body.roleName === 'Moderator') {
      customTitle = 'ContentModerator';
    }

    await this.prisma.tenantUser.create({
      data: {
        tenantId: tenant.id,
        organizationId: org.id,
        userId: user.id,
        customTitle,
        status: 'ACTIVE',
      },
    });

    // Link in UserRole table so RequirePermission guards resolve permissions
    const targetRole = await this.prisma.role.findFirst({
      where: { name: customTitle, tenantId: tenant.id },
    });
    if (targetRole) {
      await this.prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: targetRole.id,
          organizationId: org.id,
        },
      });
    }

    return {
      message: 'Registration successful! Please login.',
      userId: user.id,
    };
  }

  @Get('audit/logs')
  @UseGuards(AuthGuard)
  async getAuditLogs() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
