import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { PrismaService } from './modules/prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  // Manually configure Express body parser with 50mb limit
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Enable CORS
  app.enableCors({
    origin: true, // Dynamically mirror requesting origin to allow credentials
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Serve static files from uploads folder
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  app.use('/uploads', express.static(uploadsDir));

  // Auto-seed default categories if database table is empty or missing requested ones
  try {
    const prisma = app.get(PrismaService);
    let tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          name: 'Navi News',
          subdomain: 'navinews',
          status: 'ACTIVE',
        },
      });
    }
    const tenantId = tenant.id;

    // Seed default organization (slug is required, no description field)
    const orgSlug = 'naveen-publications';
    let org = await prisma.organization.findFirst({ where: { tenantId } });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          tenantId,
          name: 'Naveen Publications',
          slug: orgSlug,
          status: 'ACTIVE',
        },
      });
      console.log('Seeded default organization: Naveen Publications');
    }

    // Seed default admin user (User model has no tenantId/role; use TenantUser join)
    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@navinews.com';
    let adminUser = await prisma.user.findFirst({ where: { email: adminEmail, deletedAt: null } });
    if (!adminUser) {
      const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
      // Use SHA-256 as a simple password hash (no bcryptjs dependency needed)
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      adminUser = await prisma.user.create({
        data: {
          email: adminEmail,
          passwordHash,
          firstName: 'Admin',
          lastName: 'User',
          status: 'ACTIVE',
        },
      });
      // Link user to tenant + organization via TenantUser join table
      await prisma.tenantUser.create({
        data: {
          tenantId,
          organizationId: org.id,
          userId: adminUser.id,
          status: 'ACTIVE',
        },
      });
      console.log(`Seeded admin user: ${adminEmail} / ${password}`);
    }

    if (tenantId) {
      const defaultCategories = [
        'Technology', 'Politics', 'Business', 'Science', 'Sports',
        'World News', 'Entertainment', 'War', 'Jobs', 'Startups',
        'Fashion', 'Kids', 'Child Care', 'Social Welfare', 'Regional'
      ];
      let seededCount = 0;
      for (const name of defaultCategories) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const exists = await prisma.category.findFirst({
          where: { tenantId, slug, deletedAt: null },
        });
        if (!exists) {
          await prisma.category.create({
            data: {
              tenantId,
              name,
              slug,
              description: `${name} news category.`,
            },
          });
          seededCount++;
        }
      }
      if (seededCount > 0) {
        console.log(`Successfully seeded ${seededCount} new categories!`);
      }
    }
  } catch (err: any) {
    console.error(`Failed to auto-seed: ${err.message}`);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`NewsOps Backend is running on: http://localhost:${port}`);
}
bootstrap();
