import { Controller, Get, Header, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import {
  HEALTH_STATUSES,
  IndexHealth,
  JOB_NAMES,
  JOB_STATUSES,
  type HealthStatus,
  type IndexJob,
  type JobStatus,
} from '../jobs/index-health.js';

class IndexJobLogDto {
  @ApiProperty({ type: Number })
  at!: number;

  @ApiProperty({ type: String })
  message!: string;

  @ApiProperty({ type: String, nullable: true, enum: ['succeeded', 'failed', 'skipped'] })
  outcome!: 'succeeded' | 'failed' | 'skipped' | null;

  @ApiProperty({ type: Number, nullable: true })
  durationMs!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  count!: number | null;
}

class IndexJobHealthDto {
  @ApiProperty({ enum: JOB_NAMES })
  job!: IndexJob;

  @ApiProperty({ enum: JOB_STATUSES })
  status!: JobStatus;

  @ApiProperty({ type: Number, nullable: true })
  startedAt!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  finishedAt!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  lastSuccessAt!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  count!: number | null;

  @ApiProperty({ type: [IndexJobLogDto] })
  logs!: IndexJobLogDto[];
}

class IndexHealthPointDto {
  @ApiProperty({ type: Number })
  at!: number;

  @ApiProperty({ enum: HEALTH_STATUSES })
  status!: HealthStatus;
}

class IndexWorkerHealthDto {
  @ApiProperty({ type: String })
  id!: string;

  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: Number })
  lastSeenAt!: number;

  @ApiProperty({ enum: HEALTH_STATUSES })
  status!: HealthStatus;

  @ApiProperty({ type: [IndexJobHealthDto] })
  jobs!: IndexJobHealthDto[];

  @ApiProperty({ type: [IndexHealthPointDto] })
  history!: IndexHealthPointDto[];
}

class IndexHealthDto {
  @ApiProperty({ type: Number })
  checkedAt!: number;

  @ApiProperty({ type: [IndexWorkerHealthDto] })
  workers!: IndexWorkerHealthDto[];
}

@ApiTags('Admin Index Health')
@ApiBearerAuth()
@Roles('moderator', 'superadmin')
@Controller('v1/admin/search/index-health')
export class AdminIndexHealthController {
  constructor(@Inject(IndexHealth) private readonly health: IndexHealth) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: IndexHealthDto })
  async check(): Promise<IndexHealthDto> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Redis timeout')), 3000);
      });
      return await Promise.race([this.health.read(), timeout]);
    } catch {
      throw new ServiceUnavailableException('Không đọc được trạng thái worker tìm kiếm');
    } finally {
      clearTimeout(timer);
    }
  }
}
