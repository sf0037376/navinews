import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { PrismaService } from './modules/prisma/prisma.service';

// Must match auth.controller.ts hashPassword function exactly
function hashPassword(password: string): string {
  const salt = 'newsops_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

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

    // Seed SystemAdmin Role
    let adminRole = await prisma.role.findFirst({ where: { tenantId, name: 'SystemAdmin', deletedAt: null } });
    if (!adminRole) {
      adminRole = await prisma.role.create({
        data: {
          tenantId,
          name: 'SystemAdmin',
          description: 'Super administrator with access to all actions',
        },
      });
      console.log('Seeded SystemAdmin role');
    }

    // Helper to seed admins and assign roles
    const seedAdmin = async (email: string, pass: string, firstName: string, lastName: string) => {
      let adminUser = await prisma.user.findFirst({ where: { email, deletedAt: null } });
      if (!adminUser) {
        const passwordHash = hashPassword(pass);
        adminUser = await prisma.user.create({
          data: { email, passwordHash, firstName, lastName, status: 'ACTIVE' },
        });
        
        await prisma.tenantUser.create({
          data: { tenantId, organizationId: org.id, userId: adminUser.id, status: 'ACTIVE' },
        });
        console.log(`Seeded admin user: ${email} / ${pass}`);
      }

      // Ensure user has SystemAdmin role (crucial for users created before roles were added)
      const hasRole = await prisma.userRole.findFirst({
        where: { userId: adminUser.id, roleId: adminRole.id, organizationId: org.id }
      });
      if (!hasRole) {
        await prisma.userRole.create({
          data: { userId: adminUser.id, roleId: adminRole.id, organizationId: org.id },
        });
        console.log(`Assigned SystemAdmin role to: ${email}`);
      }
    };

    const naviAdminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@navinews.com';
    const naviAdminPass = process.env.SEED_ADMIN_PASSWORD || 'Admin@123456';
    await seedAdmin(naviAdminEmail, naviAdminPass, 'Admin', 'User');

    await seedAdmin('admin@newsops.com', 'test123456', 'Super', 'Admin');

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
      
      // Seed popular RSS sources
      const popularSources = [
        { name: 'BBC World News', url: 'https://www.bbc.com', feedUrl: 'http://feeds.bbci.co.uk/news/world/rss.xml', type: 'RSS', cronExpression: '*/15 * * * *' },
        { name: 'NYT World', url: 'https://www.nytimes.com', feedUrl: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', type: 'RSS', cronExpression: '*/15 * * * *' },
        { name: 'TechCrunch Technology', url: 'https://techcrunch.com', feedUrl: 'https://techcrunch.com/feed/', type: 'RSS', cronExpression: '*/15 * * * *' },
        { name: 'Wired Technology', url: 'https://www.wired.com', feedUrl: 'https://www.wired.com/feed/rss', type: 'RSS', cronExpression: '*/30 * * * *' },
        { name: 'Politico Politics', url: 'https://www.politico.com', feedUrl: 'https://rss.politico.com/politics-news.xml', type: 'RSS', cronExpression: '*/15 * * * *' },
        { name: 'CNBC Business', url: 'https://www.cnbc.com', feedUrl: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?id=10001147', type: 'RSS', cronExpression: '*/15 * * * *' },
        { name: 'ScienceDaily', url: 'https://www.sciencedaily.com', feedUrl: 'https://www.sciencedaily.com/rss/all.xml', type: 'RSS', cronExpression: '*/30 * * * *' },
        { name: 'ESPN Sports', url: 'https://www.espn.com', feedUrl: 'https://www.espn.com/espn/rss/news', type: 'RSS', cronExpression: '*/15 * * * *' },
        { name: 'Billboard Entertainment', url: 'https://www.billboard.com', feedUrl: 'https://www.billboard.com/feed/', type: 'RSS', cronExpression: '*/30 * * * *' },
        { name: 'Vogue Fashion', url: 'https://www.vogue.com', feedUrl: 'https://www.vogue.com/feed/rss', type: 'RSS', cronExpression: '*/30 * * * *' },
        { name: 'Wall Street Journal', url: 'https://www.wsj.com', feedUrl: 'https://feeds.a.dj.com/rss/RSSWSJTopStories.xml', type: 'RSS', cronExpression: '*/15 * * * *' }
      ];
      
      let seededSourcesCount = 0;
      for (const src of popularSources) {
        const exists = await prisma.source.findFirst({
          where: { feedUrl: src.feedUrl },
        });
        if (!exists) {
          await prisma.source.create({
            data: {
              organizationId: org.id,
              name: src.name,
              url: src.url,
              feedUrl: src.feedUrl,
              type: src.type as any,
              cronExpression: src.cronExpression,
              status: 'ACTIVE'
            },
          });
          seededSourcesCount++;
        }
      }
      if (seededSourcesCount > 0) {
        console.log(`Successfully seeded ${seededSourcesCount} new sources!`);
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
