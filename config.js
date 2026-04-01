/**
 * Cấu hình chung cho performance test
 * Thay đổi các giá trị ở đây thay vì sửa trực tiếp trong test script
 */

export const BASE_URL = 'http://127.0.0.1:8080';

// InfluxDB URL cho Grafana dashboard (k6 → InfluxDB → Grafana)
export const INFLUXDB_URL = 'http://localhost:8086/k6';

export const AUTH_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIyIiwiaXNzIjoiY2luZW1hLWF1dGgiLCJpYXQiOjE3NzI1ODY5MzgsImV4cCI6MTc3NTE3ODkzOH0.VRGKGixasVySrFysDuLvsgFxhR-91zISvi9Eu1dyeuERZyvHUVypeA6PeF4gLk_Rbm87-8O0Okd52i3LC-NKfjrQOcRXVIb2tidqpXxfRjy3ibN3wAkr-Yr57KiNTuvhO04nZhP7hO6ld7kPzkPw_qmKg6whDdrGlYT5ONpgFK-SzjyBD1YWUCyfEo5ZF2B-sOGi8dWrspRl_MQ2JFN84V5esFPvf_7TDqf9jhnYzkazXfzwEzOTayHFnY51G1OHy7a2eTVKtEvX5V_EwJPM4HDAiY7NADHu0jGDj8kOwpGEyvZqdgENy-A9A_CJZ26MX29hj-WAX41haXqycsr_zA';

export const DEFAULT_HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
};

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
