import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { BASE_URL, DEFAULT_HEADERS, READ_THRESHOLDS } from '../config.js';

/**
 * ============================================================
 *  USER FLOW TEST: Xem thông tin suất chiếu
 * ============================================================
 * 
 *  Flow:
 *    1. GET /api/showtime            (Lấy danh sách)
 *    2. GET /api/showtime/5          (Xem detail suất chiếu 5)
 *    3. GET /api/showtime/seatMap/5  (Xem map ghế suất chiếu 5)
 * 
 *  Chạy test:
 *    .\run.ps1 -TestFile tests/showtime-flow.test.js
 *    .\run.ps1 -TestFile tests/showtime-flow.test.js -Dashboard
 */

// --- CUSTOM METRICS DO THỜI GIAN TỪNG BƯỚC ---
const listShowtimeDuration = new Trend('flow_01_list_showtime_duration', true);
const showtimeDetailDuration = new Trend('flow_02_showtime_detail_duration', true);
const seatMapDuration = new Trend('flow_03_seat_map_duration', true);
const fullFlowDuration = new Trend('flow_full_duration', true);

// Đếm lỗi cho toàn flow
const flowErrors = new Counter('flow_errors_total');

const scenarios = {
    smoke: { executor: 'constant-vus', vus: 1, duration: '30s' },
    load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 10 },
            { duration: '1m', target: 30 },
            { duration: '30s', target: 30 },
            { duration: '30s', target: 0 },
        ],
    }
};

const selectedScenario = __ENV.SCENARIO || 'smoke';

export const options = {
    scenarios: {
        [selectedScenario]: scenarios[selectedScenario] || scenarios.smoke,
    },
    thresholds: {
        ...READ_THRESHOLDS, // Lấy cẫu hình lỗi chung từ config.js (<1% failed, duration <500ms...)
        
        // Cài đặt bẫy (threshold) riêng biệt cho từng API trong flow này
        'flow_01_list_showtime_duration': ['p(95)<600'],   // Danh sách cho phép < 600ms
        'flow_02_showtime_detail_duration': ['p(95)<300'], // Detail 1 ID nên khá nhanh < 300ms
        'flow_03_seat_map_duration': ['p(95)<400'],        // Map ghế có mảng nhiều item < 400ms
        'flow_full_duration': ['p(95)<1500'],              // Toàn bộ flow < 1.5s (không tính sleep)
    }
};

export default function () {
    const flowStart = Date.now();
    let success = true;

    // ID đang fix cứng như yêu cầu của bạn, thực tế có thể bốc random từ Bước 1
    const TARGET_SHOWTIME_ID = 5;

    // ──────────────────────────────
    // BƯỚC 1: Lấy danh sách showtime
    // ──────────────────────────────
    group('01 - Get Showtime List', function () {
        const res = http.get(`${BASE_URL}/api/showtime`, {
            headers: DEFAULT_HEADERS,
            tags: { step: 'list_showtimes' } // Tag để hiển thị tách biệt trên Grafana
        });

        // Add timing vào custom metric
        listShowtimeDuration.add(res.timings.duration);

        const ok = check(res, {
            'Step 1 (List): status is 200': (r) => r.status === 200,
        });
        if (!ok) success = false;
    });

    // Nếu bước trước lỗi thì đếm lỗi và gạch luôn flow của user này
    if (!success) { flowErrors.add(1); return; }
    
    // Giả lập user dừng lại nhìn danh sách 0.5s - 1s
    sleep(Math.random() * 0.5 + 0.5); 

    // ──────────────────────────────
    // BƯỚC 2: Xem chi tiết showtime 5
    // ──────────────────────────────
    group('02 - Get Showtime Detail', function () {
        const res = http.get(`${BASE_URL}/api/showtime/${TARGET_SHOWTIME_ID}`, {
            headers: DEFAULT_HEADERS,
            tags: { step: 'showtime_detail' }
        });

        showtimeDetailDuration.add(res.timings.duration);

        const ok = check(res, {
            'Step 2 (Detail): status is 200': (r) => r.status === 200,
        });
        if (!ok) success = false;
    });

    if (!success) { flowErrors.add(1); return; }
    sleep(Math.random() * 0.5 + 0.5);

    // ──────────────────────────────
    // BƯỚC 3: Lấy danh sách ghế cho showtime 5
    // ──────────────────────────────
    group('03 - Get Seat Map', function () {
        const res = http.get(`${BASE_URL}/api/showtime/seatMap/${TARGET_SHOWTIME_ID}`, {
            headers: DEFAULT_HEADERS,
            tags: { step: 'seat_map' }
        });

        seatMapDuration.add(res.timings.duration);

        const ok = check(res, {
            'Step 3 (SeatMap): status is 200': (r) => r.status === 200,
        });
        if (!ok) success = false;
    });

    if (!success) { flowErrors.add(1); return; }

    // Đoạn này ghi nhận thời gian khi User đi lọt được từ đầu đến cuối flow
    fullFlowDuration.add(Date.now() - flowStart);
    sleep(1);
}
