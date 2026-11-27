import { BadRequestException, Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiAcceptedResponse, ApiBadRequestResponse, ApiBearerAuth, ApiBody, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '@tripflix/auth';
import { z } from 'zod';
import { CANDIDATE_LIMIT_RANGE, PostRecommendationUseCases, type CandidateLimitInfo } from '../recommend/application/post-recommendations.use-cases.js';
import { RECOMMEND_STORE, type RecommendStore } from '../recommend/application/ports.js';
import { BUILD_FEATURES_EVERY_MS, BuildFeaturesJob } from '../recommend/jobs/build-features.job.js';
import { PURGE_INTERACTIONS_EVERY_MS, PurgeInteractionsJob } from '../recommend/jobs/purge-interactions.job.js';
import { RebuildExploreIndexJob } from '../search/jobs/rebuild-explore-index.job.js';
import { RebuildSuggestIndexJob } from '../search/jobs/rebuild-suggest-index.job.js';
import { JOB_KEYS, JOB_OUTCOMES, JobRuns, type JobKey, type JobOutcome, type JobTrigger } from './job-runs.js';

const GROUPS = ['search', 'recommend'] as const;
type JobGroup = (typeof GROUPS)[number];
const MINUTE_MS = 60_000;
/** Job admin đổi được chu kỳ. Dưới 1 phút vô nghĩa (job đọc chu kỳ mỗi phút) và mỗi lượt dựng lại toàn bộ chỉ mục. */
const INTERVAL_LIMITS = { min: MINUTE_MS, max: 24 * 60 * MINUTE_MS };
const CHANGEABLE_JOBS = 'explore, recommend_build';

export const SetJobIntervalRequestSchema = z.object({
  intervalMs: z.number().int().min(INTERVAL_LIMITS.min, 'Ít nhất 1 phút').max(INTERVAL_LIMITS.max, 'Nhiều nhất 24 giờ').nullable(),
});

export const SetCandidateLimitRequestSchema = z.object({
  limit: z
    .number()
    .int()
    .min(CANDIDATE_LIMIT_RANGE.min, `Ít nhất ${CANDIDATE_LIMIT_RANGE.min}`)
    .max(CANDIDATE_LIMIT_RANGE.max, `Nhiều nhất ${CANDIDATE_LIMIT_RANGE.max}`)
    .nullable(),
});

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

  @ApiProperty({ type: Number, nullable: true, description: 'Chu kỳ tự chạy đang dùng (ms); null = chỉ chạy lúc khởi động' })
  intervalMs!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Chu kỳ mặc định trong code (ms); null = chỉ chạy lúc khởi động' })
  defaultIntervalMs!: number | null;

  @ApiProperty({ type: Boolean, description: 'Admin đổi được chu kỳ (PUT …/jobs/:job/interval)' })
  canChangeInterval!: boolean;

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

class RankTimingDto {
  @ApiProperty({ type: Number, description: 'Số lượt dựng phiên đã ghi (tối đa 200 gần nhất, process trả lời request này)' })
  samples!: number;

  @ApiProperty({ type: Number, nullable: true, description: 'Trung vị thời gian dựng phiên (đọc ứng viên + xếp), ms; null khi chưa có lượt nào' })
  p50Ms!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  p95Ms!: number | null;
}

class CandidateLimitDto {
  @ApiProperty({ type: String, example: 'for_you' })
  algo!: string;

  @ApiProperty({ type: String, example: 'trip_v1' })
  ranker!: string;

  @ApiProperty({ type: Number, nullable: true, description: 'Số ứng viên hot ranker đang xếp; null khi ranker không đọc nhiều bài (không chỉnh được)' })
  limit!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Mặc định trong code' })
  defaultLimit!: number | null;

  @ApiProperty({ type: Boolean, description: 'Admin đã đặt khác mặc định' })
  isOverridden!: boolean;

  @ApiProperty({ type: Number, example: CANDIDATE_LIMIT_RANGE.min })
  min!: number;

  @ApiProperty({ type: Number, example: CANDIDATE_LIMIT_RANGE.max })
  max!: number;

  @ApiProperty({ type: RankTimingDto })
  rankTiming!: RankTimingDto;
}

class SetCandidateLimitRequestDto {
  @ApiProperty({ type: Number, nullable: true, minimum: CANDIDATE_LIMIT_RANGE.min, maximum: CANDIDATE_LIMIT_RANGE.max, example: 1000, description: 'Số ứng viên mới; null = về mặc định' })
  limit!: number | null;
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

  @ApiProperty({ type: CandidateLimitDto, description: 'Số ứng viên hot của for_you (chỉnh bằng PUT …/jobs/candidate-limit)' })
  candidateLimit!: CandidateLimitDto;
}

class DiscoveryJobsDto {
  @ApiProperty({ type: Number, description: 'epoch ms' })
  checkedAt!: number;

  @ApiProperty({ type: [DiscoveryJobDto] })
  jobs!: DiscoveryJobDto[];

  @ApiProperty({ type: RecommendStatsDto, nullable: true, description: 'Chỉ có khi group=recommend' })
  recommendStats!: RecommendStatsDto | null;
}

class SetJobIntervalRequestDto {
  @ApiProperty({ type: Number, nullable: true, minimum: INTERVAL_LIMITS.min, maximum: INTERVAL_LIMITS.max, example: 30 * MINUTE_MS, description: 'Chu kỳ mới (ms), 1 phút đến 24 giờ; null = về mặc định' })
  intervalMs!: number | null;
}

class JobIntervalDto {
  @ApiProperty({ enum: JOB_KEYS })
  job!: JobKey;

  @ApiProperty({ type: Number, description: 'Chu kỳ đang dùng sau khi đổi (ms)' })
  intervalMs!: number;

  @ApiProperty({ type: Number })
  defaultIntervalMs!: number;
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
  private readonly jobs: Record<JobKey, { group: JobGroup; intervalMs: number | null; canChangeInterval: boolean; instance: RunnableJob }>;

  constructor(
    @Inject(JobRuns) private readonly runs: JobRuns,
    @Inject(RECOMMEND_STORE) private readonly store: RecommendStore,
    @Inject(RebuildExploreIndexJob) explore: RebuildExploreIndexJob,
    @Inject(RebuildSuggestIndexJob) suggest: RebuildSuggestIndexJob,
    @Inject(BuildFeaturesJob) build: BuildFeaturesJob,
    @Inject(PurgeInteractionsJob) purge: PurgeInteractionsJob,
    @Inject(PostRecommendationUseCases) private readonly recommendations: PostRecommendationUseCases,
  ) {
    this.jobs = {
      explore: { group: 'search', intervalMs: explore.defaultIntervalMs, canChangeInterval: true, instance: explore },
      suggest: { group: 'search', intervalMs: null, canChangeInterval: false, instance: suggest },
      recommend_build: { group: 'recommend', intervalMs: BUILD_FEATURES_EVERY_MS, canChangeInterval: true, instance: build },
      recommend_purge: { group: 'recommend', intervalMs: PURGE_INTERACTIONS_EVERY_MS, canChangeInterval: false, instance: purge },
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
          const { intervalMs: defaultIntervalMs, canChangeInterval, instance } = this.jobs[job];
          const [runs, intervalMs] = await Promise.all([
            this.runs.list(job).catch(() => []),
            canChangeInterval && defaultIntervalMs !== null ? this.runs.getIntervalMs(job, defaultIntervalMs) : defaultIntervalMs,
          ]);
          return { job, group: group as JobGroup, intervalMs, defaultIntervalMs, canChangeInterval, isRunning: instance.isRunning, runs };
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

  @Put(':job/interval')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Đổi chu kỳ tự chạy của job (explore, recommend_build); có hiệu lực trong vòng 1 phút, không cần khởi động lại' })
  @ApiParam({ name: 'job', enum: JOB_KEYS })
  @ApiBody({ type: SetJobIntervalRequestDto })
  @ApiOkResponse({ type: JobIntervalDto })
  @ApiBadRequestResponse({ description: 'Chu kỳ ngoài 1 phút–24 giờ, hoặc job này không đổi được chu kỳ' })
  @ApiNotFoundResponse({ description: 'Không có job này' })
  async setInterval(@Param('job') job: string, @Body() body: unknown): Promise<JobIntervalDto> {
    if (!JOB_KEYS.includes(job as JobKey)) throw new NotFoundException('Không có job này');
    const { intervalMs: defaultIntervalMs, canChangeInterval } = this.jobs[job as JobKey];
    if (!canChangeInterval || defaultIntervalMs === null) {
      throw new BadRequestException({ message: 'Job này không đổi được chu kỳ', errors: [{ field: 'job', message: `Chỉ đổi được: ${CHANGEABLE_JOBS}` }] });
    }
    const parsed = SetJobIntervalRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Tham số không hợp lệ', errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    }
    await this.runs.setIntervalMs(job as JobKey, parsed.data.intervalMs);
    return { job: job as JobKey, intervalMs: parsed.data.intervalMs ?? defaultIntervalMs, defaultIntervalMs };
  }

  @Put('candidate-limit')
  @Roles('superadmin')
  @ApiOperation({ summary: 'Đặt số ứng viên hot gợi ý for_you xếp mỗi trang đầu; có hiệu lực trong vòng 1 phút, không cần deploy' })
  @ApiBody({ type: SetCandidateLimitRequestDto })
  @ApiOkResponse({ type: CandidateLimitDto })
  @ApiBadRequestResponse({ description: `Ngoài ${CANDIDATE_LIMIT_RANGE.min}–${CANDIDATE_LIMIT_RANGE.max}, hoặc ranker của for_you không đọc nhiều bài` })
  async setCandidateLimit(@Body() body: unknown): Promise<CandidateLimitInfo> {
    const parsed = SetCandidateLimitRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Tham số không hợp lệ', errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
    }
    const current = await this.recommendations.describeCandidateLimit();
    if (current.defaultLimit === null) {
      throw new BadRequestException({ message: `Ranker ${current.ranker} không đọc nhiều bài, không chỉnh được số ứng viên`, errors: [{ field: 'limit', message: 'Không áp dụng' }] });
    }
    await this.recommendations.setCandidateLimit(parsed.data.limit);
    return this.recommendations.describeCandidateLimit();
  }

  private async recommendStats(now: Date): Promise<RecommendStatsDto> {
    const [stats, algos, candidateLimit] = await Promise.all([this.store.getAdminStats(now), this.store.listActiveAlgos(), this.recommendations.describeCandidateLimit()]);
    return {
      ...stats,
      algos,
      candidateLimit,
      jobStates: stats.jobStates.map((s) => ({ ...s, lastRunAt: s.lastRunAt?.toISOString() ?? null })),
    };
  }
}
