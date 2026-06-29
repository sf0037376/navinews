import { Module, Global } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuthModule {}
