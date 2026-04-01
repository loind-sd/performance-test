import http from 'k6/http';
import { check, sleep } from 'k6';
import {BASE_URL, DEFAULT_HEADERS, READ_THRESHOLDS, THRESHOLDS} from '../config.js';

/**
 * Test: GET /api/showtime/{id}
 * 
 * Kịch bản test:
 * - Smoke test:  1 user, 30s   → kiểm tra API hoạt động bình thường
 * - Load test:   50 users, 3m  → mô phỏng tải bình thường
 * - Stress test: tăng dần lên 200 users → tìm điểm giới hạn
 * - Spike test:  đột ngột 300 users     → kiểm tra tải đột biến
 * 
 * Chạy từng scenario bằng: k6 run --env SCENARIO=smoke tests/showtime-get.test.js
 */

const scenarios = {
    smoke: {
        executor: 'constant-vus',
        vus: 1,
        duration: '30s',
    },
    load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 20 },   // ramp-up lên 20 users
            { duration: '1m', target: 50 },    // giữ ở 50 users
            { duration: '30s', target: 50 },   // giữ ổn định
            { duration: '30s', target: 0 },    // ramp-down
        ],
    },
    stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 50 },    // ramp-up nhẹ
            { duration: '1m', target: 100 },    // tăng lên 100
            { duration: '1m', target: 200 },    // stress tối đa
            { duration: '30s', target: 200 },   // giữ ổn định
            { duration: '30s', target: 0 },     // ramp-down
        ],
    },
    spike: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '10s', target: 10 },    // tải nhẹ
            { duration: '5s', target: 300 },    // spike đột ngột!
            { duration: '30s', target: 300 },   // giữ spike
            { duration: '10s', target: 10 },    // giảm nhanh
            { duration: '20s', target: 0 },     // recovery
        ],
    },
};

// Lấy scenario từ biến môi trường, mặc định là 'smoke'
const selectedScenario = __ENV.SCENARIO || 'smoke';

export const options = {
    scenarios: {
        [selectedScenario]: scenarios[selectedScenario] || scenarios.smoke,
    },
    thresholds: READ_THRESHOLDS,
};

export default function () {
    const showtimeId = 5;
    const url = `${BASE_URL}/api/showtime/${showtimeId}`;

    const res = http.get(url, { headers: DEFAULT_HEADERS });

    // Kiểm tra kết quả
    check(res, {
        'status is 200': (r) => r.status === 200,
        'response time < 500ms': (r) => r.timings.duration < 500,
        'response body is not empty': (r) => r.body && r.body.length > 0,
    });

    // Nghỉ 1s giữa mỗi iteration (mô phỏng user thật)
    sleep(1);
}
