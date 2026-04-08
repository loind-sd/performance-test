/**
 * Cấu hình chung cho performance test
 * Thay đổi các giá trị ở đây thay vì sửa trực tiếp trong test script
 */

export const BASE_URL = 'http://127.0.0.1:8080';

// InfluxDB URL cho Grafana dashboard (k6 → InfluxDB → Grafana)
export const INFLUXDB_URL = 'http://localhost:8086/k6';

export const AUTH_TOKEN = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIyIiwiaXNzIjoiY2luZW1hLWF1dGgiLCJpYXQiOjE3NzUyMDg1MjYsImV4cCI6MTc3NzgwMDUyNn0.M4GO-eOeAXSCyQkZuiINC44QeOV0UapIWsABU7LDdYYcTXFThVW_MD3tKuBL8evO3BlDdD6nY7j9c3G2JvV0IKkRGuly39FMjLsj3IfPgYv9Eybz6eVd9F3-3_T_zPAJcPVpc3KyHKpj9MppiIssoVqJQn9m2_6SnntMue86zo9knFjEI_txjEwM2O8_zDgWldpp0vwIwUyCz6Q7lAQGJPP10NWhPTAWzbjpJJr3JY5dSPk-ye_IHOHUlUim_ahHnjnGzCXJUyEzQIC0ItCBt5fUcy4Wa9J2srtChwQ1m18VeT405P2xm6rloWDD14tNYUBZPhQaczXcGoyIvvBO_Q';

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
