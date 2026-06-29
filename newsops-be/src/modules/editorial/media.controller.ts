import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';
import { diskStorage } from 'multer';

// Enforce uploads directory existence
const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

@Controller('api/v1/editorial/media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req: any, file: any, cb: any) => {
          cb(null, UPLOADS_DIR);
        },
        filename: (req: any, file: any, cb: any) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = path.extname(file.originalname);
          cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
        },
      }),
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: any,
    @Headers('x-tenant-id') tenantHeader: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded.');
    }

    // Resolve tenant ID
    const tenant = await this.prisma.tenant.findFirst();
    const tenantId = tenantHeader || tenant?.id;

    if (!tenantId) {
      throw new BadRequestException('No tenant context found.');
    }

    const host = process.env.BACKEND_HOST || 'http://localhost:3001';
    const fileUrl = `${host}/uploads/${file.filename}`;

    const mediaAsset = await this.prisma.mediaAsset.create({
      data: {
        tenantId,
        filename: file.originalname,
        storageKey: file.filename, // S3 or local key
        mimeType: file.mimetype,
        fileSize: file.size,
        altText: file.originalname.split('.')[0],
      },
    });

    return {
      message: 'File uploaded successfully',
      url: fileUrl,
      asset: mediaAsset,
    };
  }
}
