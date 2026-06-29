import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { AiModule } from './modules/ai/ai.module';
import { EditorialModule } from './modules/editorial/editorial.module';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    IntelligenceModule,
    AiModule,
    EditorialModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantInterceptor,
    },
  ],
})
export class AppModule {}
