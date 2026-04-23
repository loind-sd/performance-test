import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Counter, Rate, Gauge } from 'k6/metrics';
import { BASE_URL, makeAuthHeaders, READ_THRESHOLDS } from '../config.js';
import { authenticate } from '../lib/auth.js';

/**
 * ============================================================
 *  DATA-DRIVEN TEST + CUSTOM METRICS
 * ============================================================
 *
 *  Vấn đề với test cũ (product-get.test.js):
 *    → Hardcode showtimeId = 5
 *    → Mọi VU đều gọi cùng 1 endpoint → không realistic
 *    → Không biết API nhanh/chậm khác nhau theo data nào
 *
 *  Giải pháp:
 *    → Load data từ CSV → mỗi VU dùng data khác nhau
 *    → Custom metrics → đo chi tiết hơn default metrics
 *    → Tags → phân loại metrics theo endpoint, status, v.v.
 *
 *  Chạy:
 *    .\run.ps1 -TestFile tests/showtime-datadriven.test.js -Dashboard
 *    .\run.ps1 -TestFile tests/showtime-datadriven.test.js -Scenario load -Dashboard
 */


// ============================================================
//  1. DATA-DRIVEN: Load data từ CSV
// ============================================================
//
//  SharedArray: load data 1 lần, chia sẻ cho TẤT CẢ VUs
//  → Tiết kiệm RAM (100 VUs không tạo 100 bản copy)
//  → Data chỉ được parse 1 lần duy nhất
//
//  ⚠️ LƯU Ý:
//  - open() chỉ hoạt động trong init context (ngoài default function)
//  - SharedArray callback chỉ chạy 1 lần
//  - Không thể dùng import/require bên trong callback

const showtimeData = new SharedArray('showtimes', function () {
    //  Đọc file CSV và parse thủ công
    //  (k6 không có built-in CSV parser, nhưng đủ dùng cho file đơn giản)
    const csvContent = open('../data/showtimes.csv');
    const lines = csvContent.split('\n').filter(line => line.trim() !== '');
    const headers = lines[0].split(',');

    return lines.slice(1).map(line => {
        const values = line.split(',');
        const obj = {};
        headers.forEach((header, i) => {
            obj[header.trim()] = values[i] ? values[i].trim() : '';
        });
        return obj;
    });
});

//  Cách dùng papaparse (CSV parser chuyên nghiệp) — uncomment nếu cần:
//
//  import papaparse from 'https://jslib.k6.io/papaparse/5.3.0/index.js';
//  const showtimeData = new SharedArray('showtimes', function () {
//      return papaparse.parse(open('../data/showtimes.csv'), { header: true }).data;
//  });

console.log(`📊 Loaded ${showtimeData.length} test records from CSV`);


// ============================================================
//  2. CUSTOM METRICS: Đo những gì mình quan tâm
// ============================================================
//
//  k6 có 4 loại custom metric:
//
//  ┌─────────┬───────────────────────────────────────────────────────┐
//  │ Type    │ Mô tả                                                │
//  ├─────────┼───────────────────────────────────────────────────────┤
//  │ Trend   │ Đo thời gian/giá trị → tính min, max, avg, p90...   │
//  │ Counter │ Đếm tổng (luôn tăng)                                 │
//  │ Rate    │ Tính tỷ lệ 0-1 (ví dụ: % thành công)                │
//  │ Gauge   │ Giá trị tại 1 thời điểm (ví dụ: response size)      │
//  └─────────┴───────────────────────────────────────────────────────┘
//
//  Tham số thứ 2 = true → giá trị tính bằng milliseconds

// --- Trend: Đo thời gian chi tiết ---
const apiDuration = new Trend('api_showtime_duration', true);        // tổng thời gian API
const ttfb        = new Trend('api_showtime_ttfb', true);            // Time To First Byte
const dnsLookup   = new Trend('api_showtime_dns', true);             // DNS lookup time

// --- Counter: Đếm events ---
const totalCalls    = new Counter('api_showtime_calls_total');        // tổng số lần gọi
const statusOk      = new Counter('api_showtime_status_2xx');        // số lần trả 2xx
const statusNotFound = new Counter('api_showtime_status_404');       // số lần trả 404
const statusError   = new Counter('api_showtime_status_5xx');        // số lần trả 5xx

// --- Rate: Tỷ lệ ---
const successRate   = new Rate('api_showtime_success_rate');         // % request thành công
const slaCompliant  = new Rate('api_showtime_sla_compliant');        // % đạt SLA (< 200ms)

// --- Gauge: Giá trị hiện tại ---
const responseSize  = new Gauge('api_showtime_response_size');       // kích thước response (bytes)


// ============================================================
//  3. SCENARIOS
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
            { duration: '30s', target: 20 },
            { duration: '1m',  target: 50 },
            { duration: '30s', target: 50 },
            { duration: '30s', target: 0 },
        ],
    },
    stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 50 },
            { duration: '1m',  target: 100 },
            { duration: '1m',  target: 200 },
            { duration: '30s', target: 200 },
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
        // --- Default metrics ---
        http_req_failed: ['rate<0.05'],

        // --- Custom metric thresholds ---
        // Đây là điểm MẠNH của custom metrics:
        // bạn set ngưỡng cho TỪNG metric cụ thể
        api_showtime_duration:      ['p(90)<200', 'p(95)<500'],
        api_showtime_ttfb:          ['p(95)<300'],
        api_showtime_success_rate:  ['rate>0.95'],
        api_showtime_sla_compliant: ['rate>0.90'],        // 90% request phải đạt SLA
    },
};


// ============================================================
//  4. MAIN TEST FUNCTION
// ============================================================
export function setup() {
    const { token } = authenticate();
    return { token };
}

export default function (data) {
    // ─── DATA-DRIVEN: Lấy data cho iteration này ───
    //
    //  Có 3 cách phân bổ data cho VUs:
    //
    //  1. Sequential (tuần tự): mỗi iteration lấy dòng tiếp theo
    //     → const item = showtimeData[(__ITER) % showtimeData.length];
    //
    //  2. Random (ngẫu nhiên): mỗi iteration lấy random
    //     → const item = showtimeData[Math.floor(Math.random() * showtimeData.length)];
    //
    //  3. Per-VU (mỗi VU 1 dòng cố định):
    //     → const item = showtimeData[(__VU - 1) % showtimeData.length];

    // Dùng cách Sequential — mỗi iteration dùng 1 dòng data khác nhau
    const rowIndex = (__ITER) % showtimeData.length;
    const testItem = showtimeData[rowIndex];

    const showtimeId    = testItem.showtime_id;
    const expectedStatus = parseInt(testItem.expected_status);
    const movieName     = testItem.movie_name;


    // ─── GỌI API ───
    const url = `${BASE_URL}/api/showtime/${showtimeId}`;

    //  ✍️ TAGS: gắn tag vào request → filter/group trên Grafana
    //  Ví dụ: xem metrics riêng cho từng movie, từng status, v.v.
    const res = http.get(url, {
        headers: makeAuthHeaders(data.token),
        tags: {
            endpoint: 'GET /api/showtime',             // nhóm theo endpoint
            showtime_id: String(showtimeId),            // filter theo ID
            expected_status: String(expectedStatus),    // filter theo expected status
        },
    });


    // ─── GHI CUSTOM METRICS ───
    //
    //  res.timings chứa chi tiết timing của request:
    //  ┌──────────────────────────────────────────────────┐
    //  │  res.timings.duration      → tổng thời gian      │
    //  │  res.timings.waiting       → TTFB (server time)  │
    //  │  res.timings.connecting    → TCP connect time    │
    //  │  res.timings.tls_handshaking → TLS handshake     │
    //  │  res.timings.sending       → thời gian gửi       │
    //  │  res.timings.receiving     → thời gian nhận      │
    //  │  res.timings.blocked       → thời gian chờ slot  │
    //  └──────────────────────────────────────────────────┘

    // Trend metrics
    apiDuration.add(res.timings.duration);
    ttfb.add(res.timings.waiting);
    dnsLookup.add(res.timings.duration - res.timings.waiting - res.timings.sending - res.timings.receiving);

    // Counter metrics — đếm theo status code
    totalCalls.add(1);
    if (res.status >= 200 && res.status < 300) {
        statusOk.add(1);
    } else if (res.status === 404) {
        statusNotFound.add(1);
    } else if (res.status >= 500) {
        statusError.add(1);
    }

    // Rate metrics — tỷ lệ
    successRate.add(res.status === expectedStatus);                 // đúng expected status = success
    slaCompliant.add(res.timings.duration < 200);                  // dưới 200ms = đạt SLA

    // Gauge metrics — giá trị tại thời điểm
    responseSize.add(res.body ? res.body.length : 0);


    // ─── CHECKS ───
    //  Checks khác với Thresholds:
    //  - Check: kiểm tra TỪNG request (pass/fail cho request đó)
    //  - Threshold: kiểm tra TỔNG THỂ (95% request phải pass)

    check(res, {
        [`[${movieName}] status is ${expectedStatus}`]: (r) => r.status === expectedStatus,
        [`[${movieName}] response time < 500ms`]:       (r) => r.timings.duration < 500,
        [`[${movieName}] body is not empty`]:            (r) => r.body && r.body.length > 0,
    });


    // Think time: 0.5-1.5 giây
    sleep(Math.random() + 0.5);
}


// ============================================================
//  5. LIFECYCLE: handleSummary — Custom report
// ============================================================
//
//  handleSummary() cho phép bạn tạo custom report sau khi test xong.
//  Ví dụ: xuất ra file HTML, gửi lên Slack, v.v.

export function handleSummary(data) {
    // In summary ra console (default behavior)
    // Bạn có thể thêm custom output ở đây

    const summary = {
        // Tổng hợp custom metrics
        totalCalls: data.metrics.api_showtime_calls_total
            ? data.metrics.api_showtime_calls_total.values.count
            : 0,
        successRate: data.metrics.api_showtime_success_rate
            ? (data.metrics.api_showtime_success_rate.values.rate * 100).toFixed(1) + '%'
            : 'N/A',
        slaCompliant: data.metrics.api_showtime_sla_compliant
            ? (data.metrics.api_showtime_sla_compliant.values.rate * 100).toFixed(1) + '%'
            : 'N/A',
        avgDuration: data.metrics.api_showtime_duration
            ? data.metrics.api_showtime_duration.values.avg.toFixed(1) + 'ms'
            : 'N/A',
        p95Duration: data.metrics.api_showtime_duration
            ? data.metrics.api_showtime_duration.values['p(95)'].toFixed(1) + 'ms'
            : 'N/A',
    };

    console.log('\n╔══════════════════════════════════════╗');
    console.log('║    📊 CUSTOM METRICS SUMMARY         ║');
    console.log('╠══════════════════════════════════════╣');
    console.log(`║  Total API Calls : ${summary.totalCalls.toString().padStart(15)} ║`);
    console.log(`║  Success Rate    : ${summary.successRate.padStart(15)} ║`);
    console.log(`║  SLA Compliant   : ${summary.slaCompliant.padStart(15)} ║`);
    console.log(`║  Avg Duration    : ${summary.avgDuration.padStart(15)} ║`);
    console.log(`║  P95 Duration    : ${summary.p95Duration.padStart(15)} ║`);
    console.log('╚══════════════════════════════════════╝\n');

    // Trả về default text summary cho k6
    return {
        stdout: textSummary(data, { indent: ' ', enableColors: true }),
    };
}

// k6 built-in text summary helper
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';
