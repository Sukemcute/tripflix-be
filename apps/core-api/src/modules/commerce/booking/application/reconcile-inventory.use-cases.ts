import { Inject, Injectable, Logger } from '@nestjs/common';
import { TODAY, type Today } from '../../inventory/application/ports.js';
import { ORDER_STORE, type InventoryDrift, type OrderStore } from './ports.js';

/** Tối đa số ô lệch ghi vào log mỗi lượt; nhiều hơn thì chỉ báo tổng. */
const DRIFT_SAMPLE = 50;

/**
 * K4: đối soát tồn kho với đơn. Nhả và huỷ bán dùng greatest(0, …) nên một lần nhả thừa sẽ lặng lẽ trả chỗ của đơn khác;
 * ràng buộc database chỉ chặn bán quá, không thấy lệch. Job này chỉ phát hiện và báo, không tự sửa kho:
 * sửa sai hướng còn nguy hiểm hơn lệch, người vận hành xem đơn rồi mới chỉnh.
 */
@Injectable()
export class ReconcileInventoryUseCases {
  private readonly logger = new Logger('CommerceInventoryReconcile');

  constructor(
    @Inject(ORDER_STORE) private readonly orders: OrderStore,
    @Inject(TODAY) private readonly today: Today,
  ) {}

  async reconcile(): Promise<{ drifts: InventoryDrift[] }> {
    const drifts = await this.orders.findInventoryDrift({ fromDate: this.today(), limit: DRIFT_SAMPLE });
    if (drifts.length) this.logger.warn({ count: drifts.length, isTruncated: drifts.length >= DRIFT_SAMPLE, drifts }, 'Tồn kho lệch với đơn');
    return { drifts };
  }
}
