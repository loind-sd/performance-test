/**
 * SQL Query Performance Test — xk6-sql
 *
 * Yêu cầu: build k6 với xk6-sql trước khi chạy
 *   .\setup-xk6.ps1
 *
 * Chạy:
 *   .\run-sql.ps1 -TestFile tests/sql-query.test.js -Scenario smoke
 *   .\run-sql.ps1 -DSN "sqlserver://sa:pass@localhost:1433?database=mydb" -Scenario load
 *
 * Đổi driver: uncomment đúng dòng import bên dưới, comment các dòng còn lại.
 */

import sql from 'k6/x/sql';
import { Trend, Counter, Rate } from 'k6/metrics';
import { sleep } from 'k6';

// ─── Driver — uncomment đúng loại database của bạn ───────────────────────────
import driver from 'k6/x/sql/driver/sqlserver';   // SQL Server (mặc định)
// import driver from 'k6/x/sql/driver/mysql';     // MySQL / MariaDB
// import driver from 'k6/x/sql/driver/postgres';  // PostgreSQL

// ─── Kết nối DB (đọc từ env var DB_DSN hoặc file .env) ───────────────────────
//   SQL Server : sqlserver://user:pass@host:1433?database=mydb
//   MySQL      : user:pass@tcp(host:3306)/mydb
//   PostgreSQL : postgres://user:pass@host:5432/mydb
const db = sql.open(driver, __ENV.DB_DSN);

// ─── Custom Metrics ───────────────────────────────────────────────────────────
const sqlDuration    = new Trend('sql_query_duration', true); // ms, hiển thị p95/p99
const sqlErrors      = new Counter('sql_query_errors');
const sqlSuccessRate = new Rate('sql_success_rate');

// ─── Scenarios ────────────────────────────────────────────────────────────────
const SCENARIO = __ENV.SCENARIO || 'smoke';

const SCENARIOS = {
    smoke: {
        executor: 'constant-vus',
        vus: 1,
        duration: '30s',
    },
    load: {
        executor: 'ramping-vus',
        stages: [
            { duration: '30s', target: 5  },
            { duration: '1m',  target: 10 },
            { duration: '30s', target: 0  },
        ],
    },
    stress: {
        executor: 'ramping-vus',
        stages: [
            { duration: '30s', target: 10 },
            { duration: '1m',  target: 30 },
            { duration: '1m',  target: 50 },
            { duration: '30s', target: 0  },
        ],
    },
};

export const options = {
    scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] },
    thresholds: {
        sql_query_duration: ['p(95)<500', 'p(99)<1000'],
        sql_success_rate:   ['rate>0.99'],
    },
};

// ─── Helper: đo thời gian query + ghi metrics ─────────────────────────────────
function runQuery(label, query, ...params) {
    const t0 = Date.now();
    let ok = false;
    try {
        const rows = db.query(query, ...params);
        let count = 0;
        for (const _ of rows) { count++; }
        ok = true;
        return count;
    } catch (e) {
        sqlErrors.add(1, { query: label });
        console.error(`[${label}] ERROR: ${e}`);
        return 0;
    } finally {
        sqlDuration.add(Date.now() - t0, { query: label });
        sqlSuccessRate.add(ok, { query: label });
    }
}

// ─── Test chính ───────────────────────────────────────────────────────────────
export default function () {

    // ── Query 1: Simple SELECT — thay bằng query của bạn ─────────────────────
    runQuery(
        'simple_select',
        'SELECT TOP 100 id, name, price FROM products WHERE is_active = 1'
    );
    sleep(0.5);

    // ── Query 2: JOIN — thay bằng query của bạn ───────────────────────────────
    runQuery(
        'orders_with_customer',
        `SELECT TOP 50
             o.id,
             o.created_at,
             o.total_amount,
             c.name AS customer_name
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         WHERE o.created_at >= DATEADD(day, -7, GETDATE())
         ORDER BY o.created_at DESC`
    );
    sleep(0.5);

    // ── Query 3: Aggregation — thay bằng query của bạn ───────────────────────
    runQuery(
        'daily_revenue',
        `SELECT
             CAST(created_at AS DATE)  AS day,
             COUNT(*)                  AS total_orders,
             SUM(total_amount)         AS revenue
         FROM orders
         WHERE created_at >= DATEADD(day, -30, GETDATE())
         GROUP BY CAST(created_at AS DATE)
         ORDER BY day DESC`
    );
    sleep(1);
}

export function teardown() {
    db.close();
}
