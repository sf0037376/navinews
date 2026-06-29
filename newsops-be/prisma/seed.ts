import { PrismaClient, SourceType, SourceStatus } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  // Simple PBKDF2 hash using node native crypto
  const salt = 'newsops_salt_2026';
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

async function main() {
  console.log('Seeding NewsOps Cloud Database...');

  // 1. Generate IDs
  const tenantId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  
  const adminUserId = crypto.randomUUID();
  const editorUserId = crypto.randomUUID();
  const moderatorUserId = crypto.randomUUID();
  const authorUserId = crypto.randomUUID();

  const adminRoleId = crypto.randomUUID();
  const editorRoleId = crypto.randomUUID();
  const moderatorRoleId = crypto.randomUUID();
  const authorRoleId = crypto.randomUUID();

  // 2. Create Tenant
  console.log('Creating Tenant...');
  const tenant = await prisma.tenant.create({
    data: {
      id: tenantId,
      name: 'NewsOps Cloud',
      subdomain: 'newsops',
      status: 'ACTIVE',
    },
  });

  // 3. Create Organization
  console.log('Creating Organization...');
  const org = await prisma.organization.create({
    data: {
      id: orgId,
      tenantId: tenantId,
      name: 'Naveen Publications',
      slug: 'naveen-publications',
      status: 'ACTIVE',
    },
  });

  // 4. Create Permissions
  console.log('Creating Permissions...');
  const permissionsList = [
    { name: 'Write Articles', actionNode: 'articles:write', description: 'Create and update article drafts' },
    { name: 'Publish Articles', actionNode: 'articles:publish', description: 'Publish articles directly' },
    { name: 'Moderate Comments', actionNode: 'comments:moderate', description: 'Approve or reject comments' },
    { name: 'Manage Taxonomy', actionNode: 'taxonomy:manage', description: 'Create and edit categories/tags' },
    { name: 'Manage Ingestion Sources', actionNode: 'sources:manage', description: 'Manage RSS and scraper sources' },
  ];

  const dbPermissions: any[] = [];
  for (const perm of permissionsList) {
    const p = await prisma.permission.create({
      data: {
        id: crypto.randomUUID(),
        name: perm.name,
        actionNode: perm.actionNode,
        description: perm.description,
      },
    });
    dbPermissions.push(p);
  }

  // Helper to find permission ID by actionNode
  const getPermId = (node: string) => dbPermissions.find(p => p.actionNode === node)!.id;

  // 5. Create Roles
  console.log('Creating Roles...');
  const adminRole = await prisma.role.create({
    data: {
      id: adminRoleId,
      tenantId: tenantId,
      name: 'SystemAdmin',
      description: 'System Administrator with full access',
    },
  });

  const editorRole = await prisma.role.create({
    data: {
      id: editorRoleId,
      tenantId: tenantId,
      name: 'Editor',
      description: 'Editor who can publish and manage taxonomy',
    },
  });

  const moderatorRole = await prisma.role.create({
    data: {
      id: moderatorRoleId,
      tenantId: tenantId,
      name: 'Moderator',
      description: 'Content Moderator who can moderate comments and manage intelligence',
    },
  });

  const authorRole = await prisma.role.create({
    data: {
      id: authorRoleId,
      tenantId: tenantId,
      name: 'Author',
      description: 'Author who can draft articles but requires approval to publish',
    },
  });

  // 6. Link Roles to Permissions
  console.log('Linking Roles and Permissions...');
  
  // Admin gets all permissions
  for (const perm of dbPermissions) {
    await prisma.rolePermission.create({
      data: { roleId: adminRoleId, permissionId: perm.id },
    });
  }

  // Editor gets write, publish, moderate comments, manage taxonomy
  const editorPerms = ['articles:write', 'articles:publish', 'comments:moderate', 'taxonomy:manage'];
  for (const node of editorPerms) {
    await prisma.rolePermission.create({
      data: { roleId: editorRoleId, permissionId: getPermId(node) },
    });
  }

  // Moderator gets moderate comments, manage ingestion
  const modPerms = ['comments:moderate', 'sources:manage'];
  for (const node of modPerms) {
    await prisma.rolePermission.create({
      data: { roleId: moderatorRoleId, permissionId: getPermId(node) },
    });
  }

  // Author gets write articles
  await prisma.rolePermission.create({
    data: { roleId: authorRoleId, permissionId: getPermId('articles:write') },
  });

  // 7. Create Users
  console.log('Creating Users...');
  const defaultPassword = hashPassword('test123k');

  const adminUser = await prisma.user.create({
    data: {
      id: adminUserId,
      email: 'admin@newsops.cloud',
      passwordHash: defaultPassword,
      firstName: 'Admin',
      lastName: 'User',
      status: 'ACTIVE',
    },
  });

  const editorUser = await prisma.user.create({
    data: {
      id: editorUserId,
      email: 'editor@newsops.cloud',
      passwordHash: defaultPassword,
      firstName: 'Editor',
      lastName: 'User',
      status: 'ACTIVE',
    },
  });

  const moderatorUser = await prisma.user.create({
    data: {
      id: moderatorUserId,
      email: 'moderator@newsops.cloud',
      passwordHash: defaultPassword,
      firstName: 'Moderator',
      lastName: 'User',
      status: 'ACTIVE',
    },
  });

  const authorUser = await prisma.user.create({
    data: {
      id: authorUserId,
      email: 'author@newsops.cloud',
      passwordHash: defaultPassword,
      firstName: 'Author',
      lastName: 'User',
      status: 'ACTIVE',
    },
  });

  // 8. Create TenantUser relationships
  console.log('Linking Users to Tenant & Organization...');
  const usersToLink = [
    { userId: adminUserId, title: 'Super Administrator' },
    { userId: editorUserId, title: 'Chief Editor' },
    { userId: moderatorUserId, title: 'Community Moderator' },
    { userId: authorUserId, title: 'Staff Writer' },
  ];

  for (const item of usersToLink) {
    await prisma.tenantUser.create({
      data: {
        id: crypto.randomUUID(),
        tenantId: tenantId,
        organizationId: orgId,
        userId: item.userId,
        customTitle: item.title,
        status: 'ACTIVE',
      },
    });
  }

  // 9. Assign Roles to Users
  console.log('Assigning Roles...');
  await prisma.userRole.create({
    data: { userId: adminUserId, roleId: adminRoleId, organizationId: orgId },
  });
  await prisma.userRole.create({
    data: { userId: editorUserId, roleId: editorRoleId, organizationId: orgId },
  });
  await prisma.userRole.create({
    data: { userId: moderatorUserId, roleId: moderatorRoleId, organizationId: orgId },
  });
  await prisma.userRole.create({
    data: { userId: authorUserId, roleId: authorRoleId, organizationId: orgId },
  });

  // 10. Add RSS Ingestion Sources
  console.log('Creating RSS Ingestion Sources...');
  const rssSources = [
    {
      name: 'TechCrunch Startups',
      url: 'https://techcrunch.com/category/startups/',
      feedUrl: 'https://techcrunch.com/feed/',
      type: SourceType.RSS,
      cronExpression: '*/15 * * * *',
    },
    {
      name: 'BBC World News',
      url: 'https://www.bbc.com/news',
      feedUrl: 'http://feeds.bbci.co.uk/news/world/rss.xml',
      type: SourceType.RSS,
      cronExpression: '*/30 * * * *',
    },
    {
      name: 'CNBC Business',
      url: 'https://www.cnbc.com',
      feedUrl: 'https://search.cnbc.com/rs/search/combined/feed/rss.xml',
      type: SourceType.RSS,
      cronExpression: '*/30 * * * *',
    },
    {
      name: 'NASA Science Daily',
      url: 'https://www.nasa.gov',
      feedUrl: 'https://www.nasa.gov/feed/',
      type: SourceType.RSS,
      cronExpression: '0 * * * *',
    },
    {
      name: 'ESPN Sports News',
      url: 'https://www.espn.com',
      feedUrl: 'https://www.espn.com/espn/rss/news',
      type: SourceType.RSS,
      cronExpression: '0 * * * *',
    },
  ];

  for (const src of rssSources) {
    await prisma.source.create({
      data: {
        organizationId: orgId,
        name: src.name,
        url: src.url,
        feedUrl: src.feedUrl,
        type: src.type,
        status: SourceStatus.ACTIVE,
        cronExpression: src.cronExpression,
      },
    });
  }

  // 11. Create Default Categories
  console.log('Creating Default Categories...');
  const defaultCategories = ['Technology', 'Politics', 'Business', 'Science', 'Sports'];
  for (const name of defaultCategories) {
    const slug = name.toLowerCase();
    await prisma.category.create({
      data: {
        tenantId,
        name,
        slug,
        description: `${name} news category.`,
      },
    });
  }

  console.log('Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
