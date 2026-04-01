import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL } from '../config.js';

/**
 * ============================================================
 *  USER FLOW TEST: Booking Cinema Ticket
 * ============================================================
 * 
 *  Flow mô phỏng hành vi user thực tế:
 *    1. Login         → lấy JWT token
 *    2. Xem phim      → GET danh sách phim đang chiếu
 *    3. Chọn suất     → GET danh sách suất chiếu của phim
 *    4. Xem ghế       → GET ghế trống cho suất chiếu
 *    5. Đặt vé        → POST tạo booking
 * 
 *  KEY CONCEPTS:
 *    - group()        : nhóm các bước lại, Grafana hiện metrics theo từng group
 *    - Trend()        : custom metric đo thời gian từng bước riêng biệt
 *    - Counter()      : đếm số lần event xảy ra
 *    - Rate()         : tính tỷ lệ (ví dụ: booking thành công / tổng booking)
 *    - Correlation    : dùng response của bước trước làm input cho bước sau
 *    - Think time     : sleep() giữa các bước mô phỏng user suy nghĩ
 * 
 *  Chạy: .\run.ps1 -TestFile tests/booking-flow.test.js -Dashboard
 */

// ============================================================
//  CUSTOM METRICS - Đo từng bước riêng biệt trên Grafana
// ============================================================
//  Tại sao?: http_req_duration chỉ cho ra 1 con số chung.
//  Custom metrics giúp bạn biết chính xác bước nào chậm.

const loginDuration    = new Trend('flow_01_login_duration', true);       // ms
const moviesDuration   = new Trend('flow_02_movies_duration', true);
const showtimeDuration = new Trend('flow_03_showtime_duration', true);
const seatsDuration    = new Trend('flow_04_seats_duration', true);
const bookingDuration  = new Trend('flow_05_booking_duration', true);

// Đếm tổng booking thành công / thất bại
const bookingSuccess = new Counter('booking_success_total');
const bookingFailed  = new Counter('booking_failed_total');
const bookingRate    = new Rate('booking_success_rate');

// Đo toàn bộ flow từ đầu đến cuối
const fullFlowDuration = new Trend('flow_full_duration', true);

// ============================================================
//  SCENARIOS
// ============================================================
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
            { duration: '30s', target: 10 },
            { duration: '1m',  target: 30 },
            { duration: '30s', target: 30 },
            { duration: '30s', target: 0 },
        ],
    },
    stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 20 },
            { duration: '1m',  target: 50 },
            { duration: '1m',  target: 100 },
            { duration: '30s', target: 100 },
            { duration: '30s', target: 0 },
        ],
    },
};

const selectedScenario = __ENV.SCENARIO || 'smoke';

export const options = {
    scenarios: {
        [selectedScenario]: scenarios[selectedScenario] || scenarios.smoke,
    },
    thresholds: {
        // --- Ngưỡng chung ---
        http_req_failed: ['rate<0.05'],                        // tỷ lệ lỗi < 5%

        // --- Ngưỡng cho từng bước (key = tên custom metric) ---
        flow_01_login_duration:    ['p(95)<500'],              // login < 500ms
        flow_02_movies_duration:   ['p(95)<300'],              // xem phim < 300ms
        flow_03_showtime_duration: ['p(95)<300'],              // xem suất < 300ms
        flow_04_seats_duration:    ['p(95)<500'],              // xem ghế < 500ms
        flow_05_booking_duration:  ['p(95)<1000'],             // đặt vé < 1s
        flow_full_duration:        ['p(95)<3000'],             // toàn bộ flow < 3s

        // --- Ngưỡng business ---
        booking_success_rate:      ['rate>0.95'],              // 95% booking phải thành công
    },
};


// ============================================================
//  TEST DATA - Dữ liệu đầu vào cho mỗi VU
// ============================================================
//  Mỗi VU (virtual user) dùng data khác nhau → realistic hơn.
//  Trong thực tế, bạn có thể load từ CSV: SharedArray + papaparse
//
//  import { SharedArray } from 'k6/data';
//  import papaparse from 'https://jslib.k6.io/papaparse/5.3.0/index.js';
//  const users = new SharedArray('users', function() {
//      return papaparse.parse(open('../data/users.csv'), { header: true }).data;
//  });

const TEST_USERS = [
    { username: 'user1@cinema.com', password: 'password123' },
    { username: 'user2@cinema.com', password: 'password123' },
    { username: 'user3@cinema.com', password: 'password123' },
    { username: 'user4@cinema.com', password: 'password123' },
    { username: 'user5@cinema.com', password: 'password123' },
];


// ============================================================
//  MAIN TEST FLOW
// ============================================================
export default function () {
    const flowStart = Date.now();

    // Mỗi VU lấy 1 user khác nhau (xoay vòng theo __VU)
    const user = TEST_USERS[(__VU - 1) % TEST_USERS.length];

    let authToken = '';
    let movieId   = '';
    let showId    = '';
    let seatIds   = [];

    // ──────────────────────────────
    //  STEP 1: LOGIN
    // ──────────────────────────────
    //  ✍️ Dùng group() để Grafana hiện metrics riêng cho nhóm này
    //  ✍️ Response trả về token → lưu lại dùng cho các bước sau (correlation)

    group('01 - Login', function () {
        const payload = JSON.stringify({
            username: user.username,
            password: user.password,
        });

        const res = http.post(`${BASE_URL}/api/login`, payload, {
            headers: { 'Content-Type': 'application/json' },
            tags: { step: 'login' },   // tag để filter trên Grafana
        });

        // Ghi duration vào custom metric
        loginDuration.add(res.timings.duration);

        const success = check(res, {
            'login: status 200': (r) => r.status === 200,
            'login: has token':  (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.token !== undefined;
                } catch (e) {
                    return false;
                }
            },
        });

        // ✍️ CORRELATION: lấy token từ response để dùng ở bước sau
        if (success) {
            try {
                authToken = JSON.parse(res.body).token;
            } catch (e) {
                authToken = '';
            }
        }
    });

    // Nếu login thất bại → dừng flow, không test tiếp
    if (!authToken) {
        bookingFailed.add(1);
        bookingRate.add(false);
        return;
    }

    // Header chung cho các request sau (có token)
    const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
    };

    // ✍️ THINK TIME: mô phỏng user đọc trang sau khi login (1-3 giây)
    sleep(Math.random() * 2 + 1);

    // ──────────────────────────────
    //  STEP 2: XEM DANH SÁCH PHIM
    // ──────────────────────────────
    group('02 - Browse Movies', function () {
        const res = http.get(`${BASE_URL}/api/movies`, {
            headers: authHeaders,
            tags: { step: 'movies' },
        });

        moviesDuration.add(res.timings.duration);

        check(res, {
            'movies: status 200':  (r) => r.status === 200,
            'movies: has results': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return Array.isArray(body) && body.length > 0;
                } catch (e) {
                    return false;
                }
            },
        });

        // ✍️ CORRELATION: lấy movieId từ danh sách phim
        try {
            const movies = JSON.parse(res.body);
            if (movies.length > 0) {
                // Random chọn 1 phim (mô phỏng user chọn ngẫu nhiên)
                movieId = movies[Math.floor(Math.random() * movies.length)].id;
            }
        } catch (e) {}
    });

    if (!movieId) return;
    sleep(Math.random() * 2 + 1);

    // ──────────────────────────────
    //  STEP 3: XEM SUẤT CHIẾU
    // ──────────────────────────────
    group('03 - View Showtimes', function () {
        const res = http.get(`${BASE_URL}/api/movies/${movieId}/showtimes`, {
            headers: authHeaders,
            tags: { step: 'showtimes' },
        });

        showtimeDuration.add(res.timings.duration);

        check(res, {
            'showtimes: status 200':  (r) => r.status === 200,
            'showtimes: has results': (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return Array.isArray(body) && body.length > 0;
                } catch (e) {
                    return false;
                }
            },
        });

        // ✍️ CORRELATION: lấy showId cho bước tiếp theo
        try {
            const showtimes = JSON.parse(res.body);
            if (showtimes.length > 0) {
                showId = showtimes[Math.floor(Math.random() * showtimes.length)].id;
            }
        } catch (e) {}
    });

    if (!showId) return;
    sleep(Math.random() * 1 + 0.5);

    // ──────────────────────────────
    //  STEP 4: XEM GHẾ TRỐNG
    // ──────────────────────────────
    group('04 - Check Available Seats', function () {
        const res = http.get(`${BASE_URL}/api/showtimes/${showId}/seats`, {
            headers: authHeaders,
            tags: { step: 'seats' },
        });

        seatsDuration.add(res.timings.duration);

        check(res, {
            'seats: status 200':     (r) => r.status === 200,
            'seats: has available':  (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return Array.isArray(body) && body.some(s => s.available === true);
                } catch (e) {
                    return false;
                }
            },
        });

        // ✍️ CORRELATION: lấy 2 ghế trống ngẫu nhiên
        try {
            const seats = JSON.parse(res.body);
            const available = seats.filter(s => s.available === true);
            if (available.length >= 2) {
                // Chọn 2 ghế ngẫu nhiên
                const shuffled = available.sort(() => 0.5 - Math.random());
                seatIds = shuffled.slice(0, 2).map(s => s.id);
            } else if (available.length === 1) {
                seatIds = [available[0].id];
            }
        } catch (e) {}
    });

    if (seatIds.length === 0) return;
    sleep(Math.random() * 2 + 1);

    // ──────────────────────────────
    //  STEP 5: ĐẶT VÉ (BOOKING)
    // ──────────────────────────────
    group('05 - Create Booking', function () {
        const payload = JSON.stringify({
            showtimeId: showId,
            seatIds: seatIds,
        });

        const res = http.post(`${BASE_URL}/api/bookings`, payload, {
            headers: authHeaders,
            tags: { step: 'booking' },
        });

        bookingDuration.add(res.timings.duration);

        const success = check(res, {
            'booking: status 201 or 200': (r) => r.status === 200 || r.status === 201,
            'booking: has booking id':    (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return body.id !== undefined || body.bookingId !== undefined;
                } catch (e) {
                    return false;
                }
            },
        });

        // ✍️ Track business metric: booking success rate
        if (success) {
            bookingSuccess.add(1);
            bookingRate.add(true);
        } else {
            bookingFailed.add(1);
            bookingRate.add(false);
        }
    });

    // Ghi lại thời gian toàn bộ flow
    fullFlowDuration.add(Date.now() - flowStart);
}


// ============================================================
//  LIFECYCLE HOOKS (optional)
// ============================================================

/**
 * setup() chạy 1 lần duy nhất TRƯỚC khi test bắt đầu.
 * Dùng để: tạo test data, seed database, warm up cache, v.v.
 * Kết quả trả về sẽ được truyền vào default function.
 */
// export function setup() {
//     console.log('🚀 Setting up test data...');
//     // Ví dụ: tạo test user, seed movies, etc.
//     return { setupTimestamp: Date.now() };
// }

/**
 * teardown() chạy 1 lần duy nhất SAU khi test kết thúc.
 * Dùng để: cleanup test data, xóa booking test, v.v.
 */
// export function teardown(data) {
//     console.log('🧹 Cleaning up test data...');
//     // Ví dụ: xóa các booking đã tạo trong quá trình test
// }
