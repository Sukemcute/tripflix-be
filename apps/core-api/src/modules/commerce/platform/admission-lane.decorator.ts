import { SetMetadata, UseInterceptors, applyDecorators } from '@nestjs/common';
import { ADMISSION_LANE, type CommerceAdmissionLane } from './admission-lane.js';
import { AdmissionInterceptor } from './admission.interceptor.js';

export { ADMISSION_LANE, type CommerceAdmissionLane } from './admission-lane.js';

/** Gắn làn và interceptor ngay trên controller commerce, không chạy cho route của module khác. */
export const AdmissionLane = (lane: CommerceAdmissionLane): ClassDecorator & MethodDecorator =>
  applyDecorators(SetMetadata(ADMISSION_LANE, lane), UseInterceptors(AdmissionInterceptor));
