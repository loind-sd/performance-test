# Hướng dẫn viết file test mới

Tài liệu này hướng dẫn từng bước cách tạo một file test k6 mới từ đầu.

---

## Mục lục

1. [Khi nào cần tạo file test mới?](#1-khi-nào-cần-tạo-file-test-mới)
2. [Skeleton cơ bản](#2-skeleton-cơ-bản)
3. [Bước 1 — Khai báo import](#3-bước-1--khai-báo-import)
4. [Bước 2 — Định nghĩa scenarios](#4-bước-2--định-nghĩa-scenarios)
5. [Bước 3 — Khai báo custom metrics](#5-bước-3--khai-báo-custom-metrics)
6. [Bước 4 — Setup (lấy token)](#6-bước-4--setup-lấy-token)
7. [Bước 5 — Viết default function](#7-bước-5--viết-default-function)
8. [Pattern A — Test 1 API đơn giản](#8-pattern-a--test-1-api-đơn-giản)
9. [Pattern B — Flow nhiều bước có correlation](#9-pattern-b--flow-nhiều-bước-có-correlation)
10. [Checklist trước khi chạy](#10-checklist-trước-khi-chạy)

---

## 1. Khi nào cần tạo file test mới?

| Tình huống | Làm gì |
|------------|--------|
| Test một API mới, độc lập | Tạo file mới |
| Test một màn hình / luồng nghiệp vụ mới | Tạo file mới |
| Thêm API vào luồng đang có sẵn | Sửa file cũ |

**Quy tắc đặt tên:** `<tên-chức-năng>.test.js`
```
tests/order-flow.test.js       ✅
tests/product-get.test.js      ✅
tests/mytest.js                ❌  (thiếu .test)
tests/TestProductCreate.js     ❌  (không dùng PascalCase)
```

---

## 2. Skeleton cơ bản

Copy đoạn này làm điểm xuất phát, sau đó điền vào từng phần:

```javascript
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL, makeAuthHeaders, WRITE_THRESHOLDS } from '../config.js';
import { authenticate } from '../lib/auth.js';

// ── CUSTOM METRICS ──────────────────────────────────────────
const step01Duration = new Trend('flow_01_ten_buoc_duration', true);
const flowDuration   = new Trend('flow_full_duration', true);
const successRate    = new Rate('flow_success_rate');

// ── SCENARIOS ────────────────────────────────────────────────
const scenarios = {
    smoke:  { executor: 'constant-vus', vus: 1, duration: '30s' },
    load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 10 },
            { duration: '1m',  target: 30 },
            { duration: '30s', target: 0 },
        ],
    },
};

export const options = {
    scenarios: {
        [__ENV.SCENARIO || 'smoke']: scenarios[__ENV.SCENARIO || 'smoke'] || scenarios.smoke,
    },
    thresholds: {
        ...WRITE_THRESHOLDS,
        flow_01_ten_buoc_duration: ['p(95)<500'],
        flow_full_duration:        ['p(95)<2000'],
        flow_success_rate:         ['rate>0.95'],
    },
};

// ── SETUP ────────────────────────────────────────────────────
export function setup() {
    const { token, comId } = authenticate();
    return { token, comId };
}

// ── MAIN FLOW ────────────────────────────────────────────────
export default function (data) {
    const flowStart = Date.now();
    const headers   = makeAuthHeaders(data.token);

    group('01 - Ten buoc', function () {
        const res = http.get(`${BASE_URL}/api/your-endpoint`, {
            headers,
            tags: { step: 'ten_buoc' },
        });

        step01Duration.add(res.timings.duration);

        const ok = check(res, {
            'step01: status 200': (r) => r.status === 200,
        });

        if (!ok) {
            console.error(`[step-01] failed [${res.status}]: ${res.body.substring(0, 300)}`);
            successRate.add(false);
            return;
        }

        successRate.add(true);
    });

    flowDuration.add(Date.now() - flowStart);
    sleep(1);
}
```

---

## 3. Bước 1 — Khai báo import

```javascript
import http from 'k6/http';                            // gọi HTTP request
import { check, sleep, group } from 'k6';              // check, delay, nhóm bước
import { Trend, Counter, Rate } from 'k6/metrics';     // custom metrics
import { BASE_URL, makeAuthHeaders, WRITE_THRESHOLDS } from '../config.js';
import { authenticate } from '../lib/auth.js';
```

**Chọn threshold phù hợp:**

| Import | Dùng khi |
|--------|----------|
| `READ_THRESHOLDS` | Test chỉ có GET |
| `WRITE_THRESHOLDS` | Test có POST/PUT/DELETE |
| `THRESHOLDS` | Test hỗn hợp |

---

## 4. Bước 2 — Định nghĩa scenarios

Scenarios định nghĩa bao nhiêu VU chạy và trong bao lâu. Thường chỉ cần copy nguyên từ file khác và điều chỉnh số VU:

```javascript
const scenarios = {
    smoke: {
        executor: 'constant-vus',
        vus: 1,
        duration: '30s',
        // 1 VU chạy liên tục trong 30 giây
    },
    load: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 10 },   // tăng dần lên 10 VU
            { duration: '1m',  target: 30 },   // giữ ở 30 VU
            { duration: '30s', target: 0 },    // giảm về 0
        ],
    },
    stress: {
        executor: 'ramping-vus',
        startVUs: 0,
        stages: [
            { duration: '30s', target: 20 },
            { duration: '1m',  target: 50 },
            { duration: '1m',  target: 100 },  // đẩy lên cao để tìm điểm vỡ
            { duration: '30s', target: 0 },
        ],
    },
};

// Đọc scenario từ --env SCENARIO=load, mặc định là smoke
const selectedScenario = __ENV.SCENARIO || 'smoke';

export const options = {
    scenarios: {
        [selectedScenario]: scenarios[selectedScenario] || scenarios.smoke,
    },
    thresholds: { ... },
};
```

---

## 5. Bước 3 — Khai báo custom metrics

Custom metrics giúp đo từng bước riêng biệt thay vì chỉ xem `http_req_duration` chung.

```javascript
// Trend: đo thời gian (min, max, avg, p95...)
const step01Duration = new Trend('flow_01_ten_buoc_duration', true);  // true = tính bằng ms
const fullDuration   = new Trend('flow_full_duration', true);

// Counter: đếm số lần xảy ra (chỉ tăng, không giảm)
const successCount = new Counter('flow_success_total');
const failedCount  = new Counter('flow_failed_total');

// Rate: tỷ lệ true/false (0.0 → 1.0)
const successRate  = new Rate('flow_success_rate');
```

**Quy tắc đặt tên metric:**
```
flow_<số thứ tự>_<tên bước>_duration    →  flow_01_login_duration
flow_full_duration                       →  tổng toàn bộ flow
<tên>_total                             →  counter
<tên>_rate                              →  rate
```

Tên metric phải khớp với key trong `thresholds`:
```javascript
thresholds: {
    flow_01_ten_buoc_duration: ['p(95)<500'],  // ← phải đúng tên metric
}
```

---

## 6. Bước 4 — Setup (lấy token)

`setup()` chạy **một lần duy nhất** trước khi mọi VU bắt đầu. Dùng để authenticate và trả về dữ liệu dùng chung.

```javascript
export function setup() {
    const { token, comId } = authenticate();  // gọi API /authenticate
    return { token, comId };                  // truyền xuống default function
}
```

Trong `default function`, nhận data từ setup qua tham số:

```javascript
export default function (data) {    // ← data = { token, comId }
    const headers = makeAuthHeaders(data.token);
    const comId   = data.comId;
    // ...
}
```

> **Lưu ý:** `setup()` không chạy lại khi VU mới được tạo. Token được sinh một lần và dùng chung cho tất cả VU trong suốt quá trình test.

---

## 7. Bước 5 — Viết default function

`default function` là vòng lặp chính, mỗi VU sẽ chạy đi chạy lại liên tục.

### Cấu trúc chuẩn

```javascript
export default function (data) {
    const flowStart = Date.now();          // bắt đầu đo thời gian toàn flow
    const headers   = makeAuthHeaders(data.token);

    // ── Biến correlation (kết quả bước trước → input bước sau) ──
    let resultFromStep1 = null;

    // ── Bước 1 ──
    group('01 - Ten buoc 1', function () {
        const res = http.get(`${BASE_URL}/api/endpoint`, {
            headers,
            tags: { step: 'ten_buoc_1' },  // tag để lọc trên Grafana
        });

        step01Duration.add(res.timings.duration);  // ghi metric

        const ok = check(res, {
            'step01: status 200': (r) => r.status === 200,
        });

        if (!ok) {
            console.error(`[step-01] failed [${res.status}]: ${res.body.substring(0, 300)}`);
            return;  // dừng bước này, nhưng flow vẫn tiếp tục
        }

        // Correlation: lấy dữ liệu từ response để dùng ở bước sau
        try {
            resultFromStep1 = JSON.parse(res.body).data?.id;
        } catch {}
    });

    // Guard: nếu bước trước fail → dừng toàn flow
    if (!resultFromStep1) {
        successRate.add(false);
        return;
    }

    sleep(Math.random() * 1 + 0.5);  // think time: 0.5 → 1.5 giây

    // ── Bước 2 ──
    group('02 - Ten buoc 2', function () {
        // dùng resultFromStep1 ở đây
    });

    flowDuration.add(Date.now() - flowStart);
    sleep(1);
}
```

### Các điểm quan trọng

**`group()`** — nhóm các request lại, Grafana hiển thị metrics theo từng group:
```javascript
group('01 - Login', function () {
    // tất cả request trong này thuộc group "01 - Login"
});
```

**`tags`** — gắn nhãn để filter trên Grafana:
```javascript
http.get(url, { headers, tags: { step: 'login' } });
```

**`sleep()`** — bắt buộc có giữa các bước, mô phỏng user thật:
```javascript
sleep(1);                          // cố định 1 giây
sleep(Math.random() * 2 + 1);     // ngẫu nhiên 1-3 giây (thực tế hơn)
```

**Error logging** — luôn log lỗi với đủ thông tin:
```javascript
if (!ok) {
    console.error(`[step-01] failed [${res.status}]: ${res.body.substring(0, 300)}`);
}
```

---

## 8. Pattern A — Test 1 API đơn giản

Dùng khi chỉ cần test performance của một endpoint, không cần correlation.

```javascript
// tests/product-search.test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { BASE_URL, makeAuthHeaders, READ_THRESHOLDS } from '../config.js';
import { authenticate } from '../lib/auth.js';

const duration = new Trend('api_product_search_duration', true);

export const options = {
    scenarios: {
        [__ENV.SCENARIO || 'smoke']: {
            executor: 'constant-vus',
            vus: 1,
            duration: '30s',
        },
    },
    thresholds: {
        ...READ_THRESHOLDS,
        api_product_search_duration: ['p(95)<300'],
    },
};

export function setup() {
    const { token } = authenticate();
    return { token };
}

export default function (data) {
    const headers = makeAuthHeaders(data.token);

    const res = http.get(
        `${BASE_URL}/api/client/page/product/search?keyword=thit&page=0&size=20`,
        { headers, tags: { step: 'search' } }
    );

    duration.add(res.timings.duration);

    const ok = check(res, {
        'search: status 200': (r) => r.status === 200,
        'search: has results': (r) => {
            try { return JSON.parse(r.body).data?.length > 0; } catch { return false; }
        },
    });

    if (!ok) {
        console.error(`search failed [${res.status}]: ${res.body.substring(0, 300)}`);
    }

    sleep(1);
}
```

---

## 9. Pattern B — Flow nhiều bước có correlation

Dùng khi cần lấy dữ liệu từ API này để gọi API khác. Xem [`tests/order-flow.test.js`](../tests/order-flow.test.js) làm ví dụ đầy đủ.

Nguyên tắc:

```javascript
export default function (data) {
    // 1. Khai báo biến correlation ở scope ngoài
    let entityId = null;

    // 2. Bước đầu: lấy dữ liệu
    group('01 - Get List', function () {
        const res = http.get(`${BASE_URL}/api/items`, { headers });

        const ok = check(res, { 'list: 200': (r) => r.status === 200 });
        if (!ok) return;

        // Lấy item đầu tiên (hoặc random)
        try {
            const items = JSON.parse(res.body).data || [];
            entityId = items[0]?.id || null;
        } catch {}
    });

    // 3. Guard: không có data → bỏ qua bước sau
    if (!entityId) return;

    sleep(1);

    // 4. Bước sau: dùng dữ liệu từ bước trước
    group('02 - Get Detail', function () {
        const res = http.get(`${BASE_URL}/api/items/${entityId}`, { headers });
        check(res, { 'detail: 200': (r) => r.status === 200 });
    });
}
```

**Khi nào cần correlation?**

| Câu hỏi | Trả lời |
|---------|---------|
| Bước sau có dùng ID/data từ bước trước không? | Có → cần correlation |
| Bước sau chỉ cần chạy để tạo load? | Không cần correlation |

**Ví dụ trong order-flow:**

```
price-list  → lấy priceListId → truyền vào:
  ├── area API (?priceListId=...)
  └── get products payload { priceListId: ... }

customers   → lấy customerId → truyền vào:
  ├── voucher API (?customerId=...)
  └── create order payload { customerId: ... }
```

---

## 10. Checklist trước khi chạy

Trước khi chạy test mới, kiểm tra:

- [ ] File đặt trong thư mục `tests/`, tên kết thúc bằng `.test.js`
- [ ] Import đúng từ `../config.js` và `../lib/auth.js`
- [ ] `export function setup()` có gọi `authenticate()` và return `{ token }`
- [ ] `export default function (data)` nhận tham số `data`
- [ ] Mọi `http.get/post` đều dùng `makeAuthHeaders(data.token)`, không hardcode token
- [ ] Mỗi bước có `console.error(...)` khi check fail
- [ ] Có `sleep()` ở cuối hoặc giữa các bước
- [ ] Tên metric trong `thresholds` khớp với tên trong `new Trend(...)`
- [ ] Chạy smoke test trước để xác minh không có lỗi cú pháp

```powershell
# Luôn smoke test trước
k6 run --env SCENARIO=smoke tests/ten-file-moi.test.js

# Sau khi smoke pass thì mới chạy load/stress
k6 run --env SCENARIO=load tests/ten-file-moi.test.js
```
