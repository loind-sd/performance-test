# 🚀 Performance Test (k6)

Project performance test sử dụng [Grafana k6](https://k6.io/) để đo hiệu năng API của Cinema Spring Boot service.

## 📁 Cấu trúc project

```
performance-test/
├── config.js                # Cấu hình chung (URL, token, thresholds)
├── tests/
│   └── showtime-get.test.js   # Test GET /api/showtime/{id}
├── tools/
│   └── k6-v1.0.0-.../k6.exe  # k6 binary
├── grafana/
│   └── dashboards/
│       └── k6-performance.json  # Grafana dashboard template
├── docker-compose.yml       # InfluxDB (cho Grafana dashboard)
├── setup-grafana.ps1        # Auto-setup Grafana datasource + dashboard
├── run.ps1                  # Script chạy test nhanh
└── README.md
```

## ⚡ Cách chạy

### Chạy nhanh bằng PowerShell script
```powershell
# Smoke test (mặc định - 1 user, 30s)
.\run.ps1

# Load test (50 users, 3 phút)
.\run.ps1 -Scenario load

# Stress test (tăng dần 200 users)
.\run.ps1 -Scenario stress

# Spike test (đột ngột 300 users)
.\run.ps1 -Scenario spike
```

### Hoặc chạy trực tiếp bằng k6
```powershell
# Smoke test
.\tools\k6-v1.0.0-windows-amd64\k6.exe run tests/showtime-get.test.js

# Load test
.\tools\k6-v1.0.0-windows-amd64\k6.exe run --env SCENARIO=load tests/showtime-get.test.js

# Export kết quả ra JSON
.\tools\k6-v1.0.0-windows-amd64\k6.exe run --out json=results/output.json tests/showtime-get.test.js
```

## 📊 Grafana Dashboard (Real-time Visualization)

Xem kết quả performance test real-time trên Grafana thay vì đọc text trên terminal.

**Kiến trúc:** `k6 → InfluxDB → Grafana`

### Yêu cầu
- Docker Desktop đã cài và đang chạy
- Grafana đang chạy trên port 3000

### Setup (chỉ cần làm 1 lần)

```powershell
# 1. Khởi động InfluxDB
docker-compose up -d

# 2. Setup Grafana datasource + import dashboard
.\setup-grafana.ps1
```

### Chạy test với Grafana Dashboard

```powershell
# Smoke test + stream real-time vào Grafana
.\run.ps1 -Dashboard

# Load test + Grafana dashboard
.\run.ps1 -Scenario load -Dashboard

# Stress test + Grafana dashboard
.\run.ps1 -Scenario stress -Dashboard
```

Sau khi chạy, mở browser: **http://localhost:3000/d/k6-perf-dashboard** để xem dashboard.

### Dashboard bao gồm
| Panel | Mô tả |
|-------|--------|
| **Active Virtual Users** | Số lượng VU đang hoạt động |
| **Total Requests** | Tổng số request đã gửi |
| **Avg Response Time** | Thời gian response trung bình |
| **Error Rate** | Tỷ lệ lỗi (%) |
| **Virtual Users** | Biểu đồ VU theo thời gian |
| **Requests per Second** | Throughput (req/s) |
| **Response Time Percentiles** | p50, p90, p95, p99 theo thời gian |
| **Checks Pass Rate** | Tỷ lệ check pass (gauge) |
| **HTTP Duration Breakdown** | Phân tích: blocked, connecting, TLS, sending, waiting, receiving |
| **Data Transfer** | Dữ liệu gửi/nhận |

### Tắt InfluxDB khi không cần
```powershell
docker-compose down
```

## 📊 Các loại test

| Scenario | VUs | Thời gian | Mục đích |
|----------|-----|-----------|----------|
| **smoke** | 1 | 30s | Kiểm tra API hoạt động bình thường |
| **load** | 20→50 | ~3m | Mô phỏng tải bình thường |
| **stress** | 50→200 | ~3.5m | Tìm điểm giới hạn |
| **spike** | 10→300 | ~1.5m | Kiểm tra tải đột biến |

## 🎯 Ngưỡng đạt/không đạt (Thresholds)

- ✅ **95% requests** phải có response time < **500ms**
- ✅ **99% requests** phải có response time < **1000ms**
- ✅ **Tỷ lệ lỗi** phải < **1%**

## 🔧 Cấu hình

Chỉnh sửa file `config.js` để thay đổi:
- `BASE_URL`: URL của service cần test
- `AUTH_TOKEN`: JWT token (nhớ cập nhật khi hết hạn)
- `INFLUXDB_URL`: URL của InfluxDB (mặc định: `http://localhost:8086/k6`)
- `THRESHOLDS`: Ngưỡng performance

## 📝 Thêm test mới

Tạo file mới trong thư mục `tests/`, import config từ `../config.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, DEFAULT_HEADERS, THRESHOLDS } from '../config.js';

export const options = {
    thresholds: THRESHOLDS,
};

export default function () {
    const res = http.get(`${BASE_URL}/api/your-endpoint`, { headers: DEFAULT_HEADERS });
    check(res, { 'status is 200': (r) => r.status === 200 });
    sleep(1);
}
```
