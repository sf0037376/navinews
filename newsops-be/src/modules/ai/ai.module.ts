import { Module, Global } from '@nestjs/common';
import { AiOrchestratorService } from './ai-orchestrator.service';

@Global()
@Module({
  providers: [AiOrchestratorService],
  exports: [AiOrchestratorService],
})
export class AiModule {}
