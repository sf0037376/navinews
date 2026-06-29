import { Module } from '@nestjs/common';
import { EditorialController } from './editorial.controller';
import { CommentsController } from './comments.controller';
import { MediaController } from './media.controller';
import { SearchController } from './search.controller';
import { PublicEditorialController } from './public-editorial.controller';
import { IntelligenceModule } from '../intelligence/intelligence.module';

@Module({
  imports: [IntelligenceModule],
  controllers: [
    EditorialController,
    CommentsController,
    MediaController,
    SearchController,
    PublicEditorialController,
  ],
})
export class EditorialModule {}
