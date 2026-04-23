# Performance Test (k6)

Project performance test dùng [Grafana k6](https://k6.io/) để đo hiệu năng hệ thống bán hàng.

---

## Mục lục

1. [Cấu trúc project](#cấu-trúc-project)
2. [Cách chạy](#cách-chạy)
3. [Khái niệm cơ bản](#khái-niệm-cơ-bản)
4. [Custom Metrics](#custom-metrics)
5. [Grafana Dashboard](#grafana-dashboard)

---

## Cấu trúc project

```
performance-test/
├── config.js                   # URL, credentials, thresholds dùng chung
├── lib/
│   └── auth.js                 # Module authenticate — lấy token trước khi test
├── tests/
│   ├── product-get.test.js     # Test đơn: GET danh sách sản phẩm
│   ├── order-flow.test.js      # Flow đầy đủ: mở màn bán hàng → tạo đơn  ← quan trọng nhất
│   ├── showtime-flow.test.js   # Flow xem suất chiếu (demo)
│   └── showtime-datadriven.test.js  # Data-driven test từ CSV (demo)
├── data/
│   └── showtimes.csv           # Dữ liệu mẫu
├── grafana/
│   └── dashboards/
│       └── k6-performance.json # Template dashboard Grafana
├── .vscode/
│   ├── tasks.json              # VS Code tasks (Ctrl+Shift+B)
│   └── launch.json             # VS Code run configs (F5)
├── docker-compose.yml          # InfluxDB cho Grafana
├── setup-grafana.ps1           # Auto-setup Grafana
└── run.ps1                     # Script chạy nhanh
```

---

## Cách chạy

### Yêu cầu
- k6 đã cài (script `run.ps1` sẽ tự tải nếu chưa có)
- Service đang chạy tại địa chỉ cấu hình trong `config.js`

### Lệnh cơ bản

```powershell
# Smoke test (mặc định, 1 VU, 30 giây)
.\run.ps1 -TestFile tests/order-flow.test.js

# Load test
.\run.ps1 -TestFile tests/order-flow.test.js -Scenario load

# Stress test
.\run.ps1 -TestFile tests/order-flow.test.js -Scenario stress
```

### Chạy bằng k6 trực tiếp

```powershell
# Smoke
k6 run --env SCENARIO=smoke tests/order-flow.test.js

# Debug 1 VU — xem request/response đầy đủ
k6 run --vus 1 --duration 5s --http-debug=full tests/order-flow.test.js

# Override credentials
k6 run --env AUTH_USERNAME=admin --env AUTH_PASSWORD=secret tests/order-flow.test.js
```

### Chạy từ VS Code
- **Ctrl+Shift+B** → chọn task từ danh sách
- **F5** → chạy file đang mở với 1 VU, http-debug bật

---

## Khái niệm cơ bản

### Virtual User (VU)

VU là một "người dùng ảo" — một goroutine độc lập chạy vòng lặp `default function` liên tục trong suốt thời gian test. Mỗi VU có cookie, session, biến riêng, không chia sẻ state với VU khác.

```
10 VUs × 30s = 10 luồng chạy song song, mỗi luồng lặp lại flow nhiều lần
```

### Scenarios (Kịch bản test)

Mỗi kịch bản mô phỏng một tình huống tải khác nhau:

| Scenario | VU | Thời gian | Mục đích |
|----------|----|-----------|----------|
| **smoke** | 1 VU cố định | 30s | Sanity check — xác minh flow không bị lỗi trước khi test thật |
| **load** | 0 → 10 → 30 → 0 | ~2.5 phút | Tải bình thường — xem hệ thống xử lý tốt không |
| **stress** | 0 → 20 → 50 → 100 → 0 | ~3.5 phút | Tăng dần đến giới hạn — tìm điểm vỡ |

### Percentiles: p50 / p90 / p95 / p99

Percentile là cách đo phân phối response time, phản ánh thực tế tốt hơn trung bình (average).

**Ví dụ:** Test có 1000 request, sort theo thời gian từ nhanh → chậm:

```
p50  = 120ms  → 50% request trả về trong 120ms (request ở vị trí 500)
p90  = 380ms  → 90% request trả về trong 380ms (request ở vị trí 900)
p95  = 520ms  → 95% request trả về trong 520ms (request ở vị trí 950)
p99  = 980ms  → 99% request trả về trong 980ms (request ở vị trí 990)
```

**Tại sao không dùng average?**
Average bị kéo lệch bởi outlier. Nếu 999 request trả về 100ms nhưng 1 request trả về 60,000ms, average = ~160ms — trông ổn nhưng thực ra có request timeout. p99 = 60,000ms mới nói lên sự thật.

**Ngưỡng nên đặt:**
- `p(95)<500` — 95% user nhận được phản hồi dưới 500ms
- `p(99)<1000` — chỉ 1% user phải chờ hơn 1 giây
- Tạo đơn (write): cho phép cao hơn vì phức tạp hơn

### Thresholds (Ngưỡng pass/fail)

Thresholds quyết định test pass hay fail. Nếu một threshold bị vi phạm, k6 exit với code lỗi (CI/CD pipeline sẽ fail).

```javascript
thresholds: {
    http_req_duration: ['p(95)<500'],   // 95% request phải < 500ms
    http_req_failed:   ['rate<0.01'],   // tỷ lệ lỗi phải < 1%
    order_success_rate: ['rate>0.95'],  // 95% đơn hàng phải tạo thành công
}
```

### Checks vs Thresholds

| | Checks | Thresholds |
|--|--------|-----------|
| **Phạm vi** | Từng request | Toàn bộ test |
| **Khi fail** | Ghi nhận, test vẫn chạy | Test kết thúc với trạng thái FAIL |
| **Dùng để** | Verify logic (status 200, có field id...) | Định nghĩa SLA / điều kiện pass |

### http.batch() — Gọi song song

Trình duyệt thật gọi nhiều API song song khi load trang. `http.batch()` mô phỏng hành vi này, giúp test phản ánh đúng tải thực tế lên server.

```javascript
// Thay vì gọi tuần tự (mỗi request phải chờ cái trước)
const r1 = http.get(url1);
const r2 = http.get(url2);  // phải chờ r1 xong

// Dùng batch — gọi song song, tổng thời gian = request chậm nhất
const [r1, r2] = http.batch([
    ['GET', url1, null, { headers }],
    ['GET', url2, null, { headers }],
]);
```

### setup() — Chạy 1 lần trước khi test

`setup()` chạy một lần duy nhất trước khi bất kỳ VU nào bắt đầu. Kết quả được serialize và truyền vào `default function(data)` của mọi VU.

```
setup() ──→ authenticate() ──→ { token, comId }
                                      │
              ┌───────────────────────┼───────────────────────┐
              ↓                       ↓                       ↓
         VU 1: default(data)    VU 2: default(data)    VU 3: default(data)
```

Lý do dùng `setup()` thay vì hardcode token:
- Token luôn mới, không bao giờ hết hạn giữa chừng
- Credentials lấy từ env var, không commit lên git

---

## Grafana Dashboard

Xem kết quả real-time thay vì đọc text terminal.

**Kiến trúc:** `k6 → InfluxDB → Grafana`

### Setup (1 lần)

```powershell
# Khởi động InfluxDB
docker-compose up -d

# Setup datasource + import dashboard
.\setup-grafana.ps1
```

### Chạy với dashboard

```powershell
.\run.ps1 -TestFile tests/order-flow.test.js -Scenario load -Dashboard
```

Mở browser: **http://localhost:3000/d/k6-perf-dashboard**

### Tắt khi không dùng

```powershell
docker-compose down
```
