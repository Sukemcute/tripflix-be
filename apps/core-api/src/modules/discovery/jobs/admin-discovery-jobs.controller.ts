import { BadRequestException, Controller, Get, Header, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { RECOMMEND_STORE, type RecommendStore } from '../recommend/application/ports.js';
import { BUILD_FEATURES_EVERY_MS, BuildFeaturesJob } from '../recommend/jobs/build-features.job.js';
import { PURGE_INTERACTIONS_EVERY_MS, PurgeInteractionsJob } from '../recommend/jobs/purge-interactions.job.js';
import { EXPLORE_INDEX_INTERVAL_MS } from '../search/jobs/index-health.js';
import { RebuildExploreIndexJob } from '../search/jobs/rebuild-explore-index.job.js';
import { RebuildSuggestIndexJob } from '../search/jobs/rebuild-suggest-index.job.js';
import { JOB_KEYS, JOB_OUTCOMES, JobRuns, type JobKey, type JobOutcome, type JobTrigger } from './job-runs.js';

const GROUPS = ['search', 'recommend'] as const;
type JobGroup = (typeof GROUPS)[number];

class JobSummaryDto {
  @ApiPropertyOptional({ type: Number, description: 'Số mục trong chỉ mục (explore, suggest)' })
  count?: number;

  @ApiPropertyOptional({ type: Number, description: 'Số bài đã tính điểm (recommend_build)' })
  posts?: number;

  @ApiPropertyOptional({ type: Number, description: 'Số người đã tính gu (recommend_build)' })
  users?: number;

  @ApiPropertyOptional({ type: Number, description: 'Số dòng thô đã xoá (recommend_purge)' })
  deleted?: number;

  @ApiPropertyOptional({ type: [String], description: 'Builder lỗi trong lượt (recommend_build)' })
  failedBuilders?: string[];
}

class JobRunDto {
  @ApiProperty({ type: String })
  runId!: string;

  @ApiProperty({ enum: ['schedule', 'manual'] })
  trigger!: JobTrigger;

  @ApiProperty({ type: Number, description: 'epoch ms' })
  startedAt!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'epoch ms' })
  finishedAt!: number | null;

  @ApiProperty({ enum: JOB_OUTCOMES })
  outcome!: JobOutcome;

  @ApiProperty({ type: Number, nullable: true })
  durationMs!: number | null;

  @ApiProperty({ type: JobSummaryDto, nullable: true })
  summary!: JobSummaryDto | null;

  @ApiProperty({ type: String, nullable: true })
  error!: string | null;
}

class DiscoveryJobDto {
  @ApiProperty({ enum: JOB_KEYS })
  job!: JobKey;

  @ApiProperty({ enum: GROUPS })
  group!: JobGroup;

  @ApiProperty({ type: Number, nullable: true, description: 'Chu kỳ tự chạy (ms); null = chỉ chạy lúc khởi động' })
  intervalMs!: number | null;

  @ApiProperty({ type: Boolean, description: 'Đang chạy trên process trả lời request này' })
  isRunning!: boolean;

  @ApiProperty({ type: [JobRunDto], description: '20 lần chạy gần nhất, mới nhất trước' })
  runs!: JobRunDto[];
}

class RecommendAlgoDto {
  @ApiProperty({ type: String })
  name!: string;

  @ApiProperty({ type: String })
  postBuilder!: string;

  @ApiProperty({ type: String })
  userBuilder!: string;

  @ApiProperty({ type: String })
  ranker!: string;
}

class RecommendJobStateDto {
  @ApiProperty({ type: String, description: "'build-features' hoặc khoá builder như 'hot@v0'" })
  name!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastRunAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  lastError!: string | null;
}

class RecommendStatsDto {
  @ApiProperty({ type: Number })
  interactionsLast10m!: number;

  @ApiProperty({ type: Number })
  interactionsLast24h!: number;

  @ApiProperty({ type: Number })
  posts!: number;

  @ApiProperty({ type: Number })
  usersWithFeatures!: number;

  @ApiProperty({ type: [RecommendAlgoDto] })
  algos!: RecommendAlgoDto[];

  @ApiProperty({ type: [RecommendJobStateDto] })
  jobStates!: RecommendJobStateDto[];
}

class DiscoveryJobsDto {
  @ApiProperty({ type: Number, description: 'epoch ms' })
  checkedAt!: number;

  @ApiProperty({ type: [DiscoveryJobDto] })
  jobs!: DiscoveryJobDto[];

  @ApiProperty({ type: RecommendStatsDto, nullable: true, description: 'Chỉ có khi group=recommend' })
  recommendStats!: RecommendStatsDto | null;
}

class RunJobDto {
  @ApiProperty({ type: Boolean })
  accepted!: boolean;

  @ApiProperty({ type: String, nullable: true, enum: ['running'], description: "'running': job đang chạy, không chạy chồng" })
  reason!: 'running' | null;
}

interface RunnableJob {
  isRunning: boolean;
  run(trigger: JobTrigger): Promise<unknown>;
}

/** Trang admin theo dõi job tìm kiếm và gợi ý: xem 20 lần chạy gần nhất, bấm chạy ngay để test. */
@ApiTags('Admin Discovery Jobs')
@ApiBearerAuth()
@Controller('v1/admin/discovery/jobs')
export class AdminDiscoveryJobsController {
  private readonly jobs: Record<JobKey, { group: JobGroup; intervalMs: number | null; instance: RunnableJob }>;

  constructor(
    @Inject(JobRuns) private readonly runs: JobRuns,
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RebuildExploreIndexJob) explore: RebuildExploreIndexJob,
    @Inject(RebuildSuggestIndexJob) suggest: RebuildSuggestIndexJob,
    @Inject(BuildFeaturesJob) build: BuildFeaturesJob,
    @Inject(PurgeInteractionsJob) purge: PurgeInteractionsJob,
  ) {
    this.jobs = {
      explore: { group: 'search', intervalMs: EXPLORE_INDEX_INTERVAL_MS, instance: explore },
      suggest: { group: 'search', intervalMs: null, instance: suggest },
      recommend_build: { group: 'recommend', intervalMs: BUILD_FEATURES_EVERY_MS, instance: build },
      recommend_purge: { group: 'recommend', intervalMs: PURGE_INTERACTIONS_EVERY_MS, instance: purge },
    };
  }

  @Get()
  @Roles('moderator', 'superadmin')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Trạng thái và lịch sử chạy của job tìm kiếm hoặc gợi ý' })
  @ApiQuery({ name: 'group', required: true, enum: GROUPS })
  @ApiOkResponse({ type: DiscoveryJobsDto })
  async list(@Query('group') group: string): Promise<DiscoveryJobsDto> {
    if (!GROUPS.includes(group as JobGroup)) {
      throw new BadRequestException({ message: 'Tham số không hợp lệ', errors: [{ field: 'group', message: `Chỉ nhận ${GROUPS.join(', ')}` }] });
    }
    const keys = JOB_KEYS.filter((job) => this.jobs[job].group === group);
    const now = new Date();
    const [jobs, recommendStats] = await Promise.all([
      Promise.all(
        keys.map(async (job) => {
          const { intervalMs, instance } = this.jobs[job];
          const runs = await this.runs.list(job).catch(() => []);
          return { job, group: group as JobGroup, intervalMs, isRunning: instance.isRunning, runs };
        }),
      ),
      group === 'recommend' ? this.recommendStats(now) : Promise.resolve(null),
    ]);
    return { checkedAt: now.getTime(), jobs, recommendStats };
  }

  @Post(':job/run')
  @Roles('superadmin')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Chạy ngay một job (không chờ xong); theo dõi bằng GET' })
  @ApiParam({ name: 'job', enum: JOB_KEYS })
  @ApiAcceptedResponse({ type: RunJobDto })
  @ApiNotFoundResponse({ description: 'Không có job này' })
  run(@Param('job') job: string): RunJobDto {
    if (!JOB_KEYS.includes(job as JobKey)) throw new NotFoundException('Không có job này');
    const { instance } = this.jobs[job as JobKey];
    if (instance.isRunning) return { accepted: false, reason: 'running' };
    // Không chờ: job có thể chạy vài giây; job tự log và tự ghi lỗi vào lịch sử.
    void instance.run('manual');
    return { accepted: true, reason: null };
  }

  private async recommendStats(now: Date): Promise<RecommendStatsDto> {
    const [stats, algos] = await Promise.all([this.store.getAdminStats(now), this.store.listActiveAlgos()]);
    return {
      ...stats,
      algos,
      jobStates: stats.jobStates.map((s) => ({ ...s, lastRunAt: s.lastRunAt?.toISOString() ?? null })),
    };
  }
}
