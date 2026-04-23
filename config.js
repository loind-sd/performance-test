/**
 * Cấu hình chung cho performance test
 * Thay đổi các giá trị ở đây thay vì sửa trực tiếp trong test script
 */

export const BASE_URL = 'http://14.225.17.199:8888';

// InfluxDB URL cho Grafana dashboard (k6 → InfluxDB → Grafana)
export const INFLUXDB_URL = 'http://localhost:8086/k6';

// Auth config — token được lấy động qua setup() + lib/auth.js
// Override bằng env vars: k6 run --env AUTH_USERNAME=... --env AUTH_PASSWORD=...
export const AUTH_ENDPOINT = __ENV.AUTH_ENDPOINT || '/api/client/common/authenticate';
export const AUTH_CREDENTIALS = {
    username: __ENV.AUTH_USERNAME || 'demo',
    password: __ENV.AUTH_PASSWORD || 'Epos@123',
    companyId: __ENV.AUTH_COMPANY_ID || null,
};

// Tạo headers có Authorization từ token lấy được ở setup()
export function makeAuthHeaders(token) {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };
}

/**
 * Ngưỡng performance (thresholds)
 * - http_req_duration: thời gian response trung bình
 * - http_req_failed: tỷ lệ request thất bại
 */
export const THRESHOLDS = {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],  // 95% request < 500ms, 99% < 1s
    http_req_failed: ['rate<0.01'],                    // tỷ lệ lỗi < 1%
};


// Ngưỡng cho API đọc (GET)
export const READ_THRESHOLDS = {
  http_req_duration: ['p(90)<200', 'p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'],
};


// Ngưỡng cho API ghi (POST/PUT/DELETE)
export const WRITE_THRESHOLDS = {
  http_req_duration: ['p(90)<500', 'p(95)<1000', 'p(99)<2000'],
  http_req_failed: ['rate<0.01'],
};
