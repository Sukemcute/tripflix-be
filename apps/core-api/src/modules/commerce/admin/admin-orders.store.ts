import { Injectable } from '@nestjs/common';
import { InjectTransactionHost, type Db } from '@tripflix/db';
import { sql, type SQL } from 'drizzle-orm';
import { ANOMALY_KINDS, type AnomalyKind } from './anomaly-kinds.js';

/** host.tx là kết nối commerce (ngoài transaction thì là kết nối thường); test truyền { tx: db }. */
export interface AdminDbHost {
  readonly tx: Db;
}

export interface AdminOrderRow {
  id: string;
  userId: string;
  status: string;
  total: number;
  confirmationCode: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
}

export interface AdminProductRow {
  id: string;
  name: string;
  /** Phòng: tên khách sạn. Chuyến bay: hãng. */
  parentName: string;
  /** Phòng: tỉnh. Chuyến bay: sân bay đi → đến. */
  place: string;
}

export interface AnomalyRow {
  kind: AnomalyKind;
  orderId: string;
  confirmationCode: string | null;
  orderStatus: string;
  total: number;
  /** Số liệu để người vận hành xem nhanh, khác nhau theo loại (số lần trừ, số tiền, mã khoản trừ...). */
  detail: Record<string, unknown>;
  /** Lúc bắt đầu bất thường (khoản trừ / hoàn gần nhất liên quan, hoặc lúc trả đơn). */
  since: Date;
}

/** Tiền đã vào tài khoản cổng: cổng báo thành công, hoặc có giờ trả từ cổng dù trạng thái nội bộ chưa kịp đổi. */
const CHARGED = sql`(p.status = 'succeeded' or p.gateway_paid_at is not null)`;
/** Phần tiền của khoản trừ chưa hoàn xong (hoàn đang chạy chưa tính là đã hoàn). */
const UNREFUNDED = sql`p.amount - coalesce((select sum(r.amount) from commerce.refunds r where r.payment_id = p.id and r.status = 'succeeded'), 0)`;

const ORDER_COLUMNS = sql`o.id, o.user_id as "userId", o.status, o.total, o.confirmation_code as "confirmationCode",
  o.contact_name as "contactName", o.contact_phone as "contactPhone", o.contact_email as "contactEmail",
  o.created_at as "createdAt", o.paid_at as "paidAt", o.cancelled_at as "cancelledAt"`;

/**
 * TF43: đọc đơn cho quản trị và tìm đơn bất thường. Chỉ đọc, không sửa gì: hoàn tiền, trả kho do người vận hành quyết sau
 * khi xem (cùng lý do với job đối soát kho K4).
 */
@Injectable()
export class AdminOrdersStore {
  constructor(@InjectTransactionHost('commerce') private readonly host: AdminDbHost) {}

  private get db(): Db {
    return this.host.tx;
  }

  /** Tìm theo mã xác nhận, mã đơn, mã người dùng, số điện thoại hoặc email liên hệ. Mới nhất trước, phân trang theo createdAt. */
  async search(input: { q?: string; statuses?: string[]; before?: Date; limit: number }): Promise<AdminOrderRow[]> {
    const where: SQL[] = [];
    if (input.q) {
      const q = input.q.trim();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
      where.push(
        isUuid
          ? sql`(o.id = ${q}::uuid or o.user_id = ${q}::uuid)`
          : sql`(o.confirmation_code = ${q.toUpperCase()} or o.contact_phone = ${q} or lower(o.contact_email) = ${q.toLowerCase()})`,
      );
    }
    if (input.statuses?.length) where.push(sql`o.status in (${sql.join(input.statuses.map((s) => sql`${s}`), sql`, `)})`);
    if (input.before) where.push(sql`o.created_at < ${input.before.toISOString()}::timestamptz`);
    const filter = where.length ? sql`where ${sql.join(where, sql` and `)}` : sql``;
    const result = await this.db.execute<AdminOrderRow>(sql`select ${ORDER_COLUMNS} from commerce.orders o ${filter} order by o.created_at desc limit ${input.limit}`);
    return result.rows.map(normalizeOrder);
  }

  /**
   * Danh sách loại phòng / chuyến bay để màn Lịch trống chọn mã thay vì gõ tay. Tìm theo mã, tên, khách sạn, tỉnh,
   * sân bay hoặc số hiệu chuyến.
   */
  async searchProducts(input: { kind: 'room' | 'flight'; q?: string; limit: number }): Promise<AdminProductRow[]> {
    const like = input.q ? `%${input.q.trim().toLowerCase()}%` : null;
    const result =
      input.kind === 'room'
        ? await this.db.execute<AdminProductRow>(sql`
            select r.id, r.name, p.name as "parentName", p.province_name as "place"
            from commerce.room_types r join commerce.properties p on p.id = r.property_id
            where ${like}::text is null or lower(r.id) like ${like} or lower(r.name) like ${like} or lower(p.name) like ${like} or lower(p.province_name) like ${like}
            order by p.name, r.name limit ${input.limit}`)
        : await this.db.execute<AdminProductRow>(sql`
            select f.id, f.name, coalesce(f.airline, '') as "parentName", f.from_airport || ' → ' || f.to_airport as "place"
            from commerce.flights f
            where ${like}::text is null or lower(f.id) like ${like} or lower(f.name) like ${like} or lower(coalesce(f.airline, '')) like ${like}
               or lower(f.from_airport || '-' || f.to_airport) like ${like} or lower(coalesce(f.flight_number, '')) like ${like}
            order by f.from_airport, f.to_airport, f.id limit ${input.limit}`);
    return result.rows;
  }

  /** Toàn bộ hồ sơ một đơn: mục, khách, các lần trừ tiền, hoàn tiền, lịch sử trạng thái. */
  async detail(orderId: string) {
    const order = await this.db.execute<AdminOrderRow>(sql`select ${ORDER_COLUMNS} from commerce.orders o where o.id = ${orderId}::uuid`);
    if (!order.rows[0]) return null;
    const [items, guests, payments, refunds, history] = await Promise.all([
      this.db.execute<Record<string, unknown>>(sql`select id, product_type as "productType", product_id as "productId", product_name as "productName", date, nights, qty,
        line_total::bigint::float8 as "lineTotal", rate_plan_code as "ratePlanCode", confirmation_code as "confirmationCode"
        from commerce.order_items where order_id = ${orderId}::uuid order by date, id`),
      this.db.execute<Record<string, unknown>>(sql`select full_name as "fullName", birthdate, passenger_type as "passengerType" from commerce.order_guests where order_id = ${orderId}::uuid order by id`),
      this.db.execute<Record<string, unknown>>(sql`select id, gateway, status, amount::float8 as amount, gateway_ref as "gatewayRef", gateway_paid_at as "gatewayPaidAt",
        failure_code as "failureCode", card_last4 as "cardLast4", check_attempts as "checkAttempts", needs_review as "needsReview",
        created_at as "createdAt", updated_at as "updatedAt"
        from commerce.payments where order_id = ${orderId}::uuid order by created_at`),
      this.db.execute<Record<string, unknown>>(sql`select id, payment_id as "paymentId", amount::float8 as amount, reason, status, gateway_ref as "gatewayRef",
        needs_review as "needsReview", created_at as "createdAt", gateway_refunded_at as "gatewayRefundedAt"
        from commerce.refunds where order_id = ${orderId}::uuid order by created_at`),
      this.db.execute<Record<string, unknown>>(sql`select from_status as "fromStatus", to_status as "toStatus", source, request_id as "requestId", created_at as "createdAt"
        from commerce.order_status_history where order_id = ${orderId}::uuid order by created_at, id`),
    ]);
    return { order: normalizeOrder(order.rows[0]), items: items.rows, guests: guests.rows, payments: payments.rows, refunds: refunds.rows, history: history.rows };
  }

  /**
   * Đơn bất thường theo từng loại (xem anomaly-kinds.ts). Mỗi loại tối đa `limitPerKind` đơn, cũ nhất trước để xử lý theo thứ tự.
   * orderId truyền vào thì chỉ xét đơn đó (màn chi tiết đơn).
   */
  async findAnomalies(input: { kinds?: AnomalyKind[]; orderId?: string; limitPerKind: number; now: Date }): Promise<AnomalyRow[]> {
    const kinds = input.kinds?.length ? input.kinds : [...ANOMALY_KINDS];
    const now = sql`${input.now.toISOString()}::timestamptz`;
    const onlyOrder = input.orderId ? sql`and o.id = ${input.orderId}::uuid` : sql``;
    const onlyOrderCells = input.orderId ? sql`and c.order_id = ${input.orderId}::uuid` : sql``;
    const today = sql`(${now} at time zone 'Asia/Ho_Chi_Minh')::date`;
    const queries: Record<AnomalyKind, SQL> = {
      // Hai khoản trở lên đã vào tiền mà chưa hoàn xong. Database chỉ chặn hai khoản cùng "đang sống"; khoản đã failed
      // nhưng cổng vẫn có giờ trả (IPN đến muộn, mất phản hồi) thì vẫn lọt.
      double_charge: sql`
        select o.id, max(p.created_at) as since,
               jsonb_build_object('charges', count(*), 'chargedAmount', sum(p.amount), 'paymentIds', jsonb_agg(p.id order by p.created_at)) as detail
        from commerce.orders o join commerce.payments p on p.order_id = o.id
        where ${CHARGED} and ${UNREFUNDED} > 0 ${onlyOrder}
        group by o.id having count(*) >= 2`,
      // Đã trừ tiền nhưng đơn chưa từng trả (hết hạn giữ, bị huỷ, kẹt pending/paying): khách mất tiền mà không có chỗ.
      // Chờ 10 phút để không báo nhầm lúc job đối soát đang chốt đơn.
      charged_without_seat: sql`
        select o.id, max(p.created_at) as since,
               jsonb_build_object('chargedAmount', sum(p.amount), 'unrefunded', sum(${UNREFUNDED}), 'paymentIds', jsonb_agg(p.id order by p.created_at)) as detail
        from commerce.orders o join commerce.payments p on p.order_id = o.id
        where o.status <> 'paid' and o.paid_at is null and ${CHARGED} and ${UNREFUNDED} > 0
          and p.created_at < ${now} - interval '10 minutes' ${onlyOrder}
        group by o.id`,
      // Đơn paid mà kho ghi thiếu chỗ bán ở một ngày từ hôm nay trở đi, hoặc mục chưa có mã xác nhận. Bỏ ngày đã qua:
      // job dọn dẹp có thể đã xoá lịch cũ, xét vào sẽ báo nhầm, và cũng không còn gì để giữ chỗ cho khách.
      // Dùng phép nối thường thay cho IN theo bộ và truy vấn con từng đơn: với ~60 nghìn đơn paid bản cũ quá 10 giây.
      paid_without_seat: sql`
        with order_cells as (
          select i.order_id, i.product_type, i.product_id, (i.date + g.n)::date as date, i.qty
          from commerce.order_items i join commerce.orders o on o.id = i.order_id
          cross join lateral generate_series(0, greatest(i.nights, 1) - 1) as g(n)
          where o.status = 'paid' and (i.date + g.n) >= ${today}
        ),
        expected as (
          select c.product_type, c.product_id, c.date, sum(c.qty)::int as sold
          from order_cells c ${input.orderId ? sql`join (select distinct product_type, product_id, date from order_cells c where true ${onlyOrderCells}) t using (product_type, product_id, date)` : sql``}
          group by 1, 2, 3
        ),
        -- Tra từng ô kho theo khoá chính: planner đoán sai số dòng của generate_series nên tự chọn quét cả bảng kho (~1 triệu ô).
        short as (
          select * from (
            select e.product_type, e.product_id, e.date, e.sold as expected_sold,
                   coalesce(case when e.product_type = 'room'
                                 then (select ri.sold from commerce.room_inventory ri where ri.room_type_id = e.product_id and ri.date = e.date)
                                 else (select fi.sold from commerce.flight_inventory fi where fi.flight_id = e.product_id and fi.date = e.date) end, 0) as sold
            from expected e
          ) cell where cell.sold < cell.expected_sold
        ),
        flagged as (
          select c.order_id as id,
                 jsonb_agg(jsonb_build_object('productId', s.product_id, 'date', s.date, 'sold', s.sold, 'expectedSold', s.expected_sold) order by s.date) as short_cells
          from order_cells c join short s using (product_type, product_id, date)
          where true ${onlyOrderCells}
          group by c.order_id
        ),
        no_code as (
          select i.order_id as id, count(*)::int as n
          from commerce.order_items i join commerce.orders o on o.id = i.order_id
          where o.status = 'paid' and i.confirmation_code is null ${onlyOrder}
          group by i.order_id
        )
        select o.id, o.paid_at as since,
               jsonb_build_object('shortCells', coalesce(f.short_cells, '[]'::jsonb), 'itemsWithoutCode', coalesce(n.n, 0)) as detail
        from flagged f full join no_code n on n.id = f.id
        join commerce.orders o on o.id = coalesce(f.id, n.id)`,
      // Đơn paid mà không có khoản trừ thành công nào, hoặc số đã trừ khác tổng đơn.
      paid_amount_mismatch: sql`
        select o.id, o.paid_at as since,
               jsonb_build_object('chargedAmount', coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0)) as detail
        from commerce.orders o left join commerce.payments p on p.order_id = o.id
        where o.status = 'paid' ${onlyOrder}
        group by o.id having coalesce(sum(p.amount) filter (where p.status = 'succeeded'), 0) <> o.total`,
      // Khoản trừ kẹt: chờ cổng quá 30 phút, hoặc job đối soát đã bỏ cuộc và chuyển người xử lý.
      stuck_payment: sql`
        select o.id, min(p.created_at) as since,
               jsonb_build_object('paymentIds', jsonb_agg(p.id order by p.created_at), 'statuses', jsonb_agg(p.status order by p.created_at),
                                  'needsReview', bool_or(p.needs_review), 'checkAttempts', max(p.check_attempts)) as detail
        from commerce.orders o join commerce.payments p on p.order_id = o.id
        where (p.needs_review or (p.status in ('initiated', 'requires_action') and p.created_at < ${now} - interval '30 minutes')) ${onlyOrder}
        group by o.id`,
      // Khoản hoàn cần người xử lý (VNPay chưa hoàn tự động) hoặc chưa xong sau một ngày.
      refund_needs_review: sql`
        select o.id, min(r.created_at) as since,
               jsonb_build_object('refundIds', jsonb_agg(r.id order by r.created_at), 'amount', sum(r.amount), 'reasons', jsonb_agg(r.reason order by r.created_at)) as detail
        from commerce.orders o join commerce.refunds r on r.order_id = o.id
        where r.status <> 'succeeded' and (r.needs_review or r.created_at < ${now} - interval '1 day') ${onlyOrder}
        group by o.id`,
    };

    // Mỗi loại một câu, chạy song song (ngoài transaction nên mỗi câu lấy một kết nối riêng): gộp union all thì chạy nối tiếp.
    const perKind = await Promise.all(
      kinds.map((kind) =>
        this.db.execute<AnomalyRow>(sql`select ${kind}::text as kind, o.id as "orderId", o.confirmation_code as "confirmationCode", o.status as "orderStatus", o.total, a.detail, a.since
          from (${queries[kind]}) a join commerce.orders o on o.id = a.id order by a.since asc nulls last limit ${input.limitPerKind}`),
      ),
    );
    return perKind.flatMap((result) => result.rows).map((row) => ({ ...row, total: Number(row.total), since: new Date(row.since) }));
  }
}

const toDate = (value: Date | string | null) => (value === null ? null : new Date(value));
/** execute() thô trả bigint và timestamptz dạng chuỗi. */
const normalizeOrder = (row: AdminOrderRow): AdminOrderRow => ({
  ...row,
  total: Number(row.total),
  createdAt: new Date(row.createdAt),
  paidAt: toDate(row.paidAt),
  cancelledAt: toDate(row.cancelledAt),
});
