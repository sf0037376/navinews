import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
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
          name: 'NewsOps Cloud',
          subdomain: 'newsops',
          status: 'ACTIVE',
        },
      });
    }
    const tenantId = tenant.id;
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
    console.error(`Failed to auto-seed categories: ${err.message}`);
  }

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`NewsOps Backend is running on: http://localhost:${port}`);
}
bootstrap();
