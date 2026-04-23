import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL, makeAuthHeaders, WRITE_THRESHOLDS } from '../config.js';
import { authenticate } from '../lib/auth.js';

/**
 * ============================================================
 *  USER FLOW TEST: Tạo đơn hàng (màn bán hàng)
 * ============================================================
 *
 *  Flow:
 *    01 - Page Load        → batch 6 API khởi tạo màn hình (song song)
 *    02 - Customer & Voucher → DS khách hàng (correlation) + voucher (load only)
 *    03 - Get Products     → DS sản phẩm (correlation: chọn SP để tạo đơn)
 *    04 - Create Order     → POST tạo đơn
 *
 *  Chạy:
 *    k6 run --env SCENARIO=smoke tests/order-flow.test.js
 *    k6 run --vus 1 --duration 5s --http-debug=full tests/order-flow.test.js
 */

// ============================================================
//  CUSTOM METRICS
// ============================================================
const pageLoadDuration    = new Trend('flow_01_page_load_duration', true);
const customerDuration    = new Trend('flow_02_customer_duration', true);
const voucherDuration     = new Trend('flow_02b_voucher_duration', true);
const productsDuration    = new Trend('flow_03_products_duration', true);
const createOrderDuration = new Trend('flow_04_create_order_duration', true);
const fullFlowDuration    = new Trend('flow_full_duration', true);

const orderSuccess = new Counter('order_success_total');
const orderFailed  = new Counter('order_failed_total');
const orderRate    = new Rate('order_success_rate');


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
        ...WRITE_THRESHOLDS,
        flow_01_page_load_duration:  ['p(95)<2000'],
        flow_02_customer_duration:   ['p(95)<500'],
        flow_02b_voucher_duration:   ['p(95)<500'],
        flow_03_products_duration:   ['p(95)<500'],
        flow_04_create_order_duration: ['p(95)<1000'],
        flow_full_duration:          ['p(95)<8000'],
        order_success_rate:          ['rate>0.95'],
    },
};


// ============================================================
//  HELPERS
// ============================================================
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function formatDateTime(date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function randomKey(len) {
    return Math.random().toString(36).substring(2, 2 + len);
}


// ============================================================
//  SETUP — chạy 1 lần, lấy token + comId
// ============================================================
export function setup() {
    const { token, comId } = authenticate();
    return { token, comId };
}


// ============================================================
//  MAIN FLOW
// ============================================================
export default function (data) {
    const flowStart = Date.now();
    const headers   = makeAuthHeaders(data.token);
    const comId     = data.comId;

    let priceListId      = null;   // từ step 01, dùng cho area + get products
    let warehouseId      = null;   // từ step 01, dùng cho get products
    let customerId       = null;   // từ step 02, dùng cho voucher + tạo đơn
    let customerName     = 'Khách lẻ'; // từ step 02
    let selectedProducts = [];     // từ step 03, dùng cho tạo đơn


    // ══════════════════════════════════════════════════════════
    //  STEP 01: PAGE LOAD
    //  6 API không phụ thuộc nhau → batch song song
    //  Ngoại trừ area → cần priceListId từ price-list
    // ══════════════════════════════════════════════════════════
    group('01 - Page Load', function () {
        const t0 = Date.now();

        const [
            resWarehouse,
            resNotification,
            resDefaultProducts,
            resProductGroups,
            resPriceList,
            resSurcharge,
        ] = http.batch([
            ['GET', `${BASE_URL}/api/client/page/warehouse/get-with-paging?comId=${comId}&status=1&page=0&size=100`,                         null, { headers, tags: { step: 'page_load' } }],
            ['GET', `${BASE_URL}/api/client/page/notification/get-with-paging?page=0&size=20&isUnRead=true&type=0`,                          null, { headers, tags: { step: 'page_load' } }],
            ['GET', `${BASE_URL}/api/client/page/product/get-default-products`,                                                              null, { headers, tags: { step: 'page_load' } }],
            ['GET', `${BASE_URL}/api/client/page/product-group/get-with-paging?page=0&size=100`,                                             null, { headers, tags: { step: 'page_load' } }],
            ['GET', `${BASE_URL}/api/client/price-list/get-with-paging?page=0&size=50&keyword=&isValid=true&onlyActive=true&oldPriceTagId=0`, null, { headers, tags: { step: 'page_load' } }],
            ['GET', `${BASE_URL}/api/client/page/surcharge/get-with-paging?page=0&size=100`,                                                 null, { headers, tags: { step: 'page_load' } }],
        ]);

        const pageLoadChecks = [
            [resWarehouse,       'warehouse'],
            [resNotification,    'notification'],
            [resDefaultProducts, 'default-products'],
            [resProductGroups,   'product-groups'],
            [resPriceList,       'price-list'],
            [resSurcharge,       'surcharge'],
        ];
        for (const [res, name] of pageLoadChecks) {
            const ok = check(res, { [`${name}: 200`]: (r) => r.status === 200 });
            if (!ok) {
                console.error(`[page-load] ${name} failed [${res.status}]: ${res.body.substring(0, 300)}`);
            }
        }

        // Lấy priceListId và warehouseId để dùng ở các step sau
        try {
            const body = JSON.parse(resPriceList.body);
            const list = body.data || body;
            priceListId = list[0]?.id || list[0]?.priceListId || null;
        } catch {}

        try {
            const body = JSON.parse(resWarehouse.body);
            const list = body.data || body;
            warehouseId = list[0]?.id || list[0]?.warehouseId || null;
        } catch {}

        if (priceListId) {
            const resArea = http.get(
                `${BASE_URL}/api/client/page/area/get-all-with-paging?areaSize=100&areaUnitSize=100&priceListId=${priceListId}`,
                { headers, tags: { step: 'page_load' } }
            );
            const okArea = check(resArea, { 'area: 200': (r) => r.status === 200 });
            if (!okArea) {
                console.error(`[page-load] area failed [${resArea.status}]: ${resArea.body.substring(0, 300)}`);
            }
        }

        pageLoadDuration.add(Date.now() - t0);
    });

    sleep(Math.random() + 0.5); // user nhìn màn hình sau khi load


    // ══════════════════════════════════════════════════════════
    //  STEP 02: CUSTOMER + VOUCHER
    //
    //  Customer và product độc lập → batch song song.
    //  Voucher cần customerId → gọi sau khi có customer.
    //
    //  Correlation:
    //    customer → customerId (dùng cho voucher + tạo đơn)
    //    voucher  → KHÔNG cần (chỉ tạo load thực tế)
    // ══════════════════════════════════════════════════════════
    group('02 - Customer & Voucher', function () {
        // Lấy danh sách khách hàng (correlation: cần customerId)
        const resCustomer = http.get(
            `${BASE_URL}/api/client/page/customer/get-all-with-paging?page=0&size=20&sort=id,asc&type=1&totalPage=0`,
            { headers, tags: { step: 'customer' } }
        );

        customerDuration.add(resCustomer.timings.duration);

        const okCustomer = check(resCustomer, {
            'customer: status 200': (r) => r.status === 200,
            'customer: has data':   (r) => {
                try {
                    const body = JSON.parse(r.body);
                    const list = body.data || body;
                    return Array.isArray(list) && list.length > 0;
                } catch { return false; }
            },
        });
        if (!okCustomer) {
            console.error(`[step-02] customer failed [${resCustomer.status}]: ${resCustomer.body.substring(0, 300)}`);
        }

        // Correlation: lấy customerId + customerName đầu tiên
        try {
            const body = JSON.parse(resCustomer.body);
            const list = body.data || body;
            customerId   = list[0]?.id       || null;
            customerName = list[0]?.fullName || list[0]?.name || 'Khách lẻ';
        } catch {}

        // Voucher: cần customerId → gọi sau, không dùng kết quả
        if (customerId) {
            const resVoucher = http.get(
                `${BASE_URL}/api/client/page/voucher/get-for-bill?customerId=${customerId}&totalItem=0`,
                { headers, tags: { step: 'voucher' } }
            );
            voucherDuration.add(resVoucher.timings.duration);
            const okVoucher = check(resVoucher, { 'voucher: status 200': (r) => r.status === 200 });
            if (!okVoucher) {
                console.error(`[step-02] voucher failed [${resVoucher.status}]: ${resVoucher.body.substring(0, 300)}`);
            }
        }
    });

    sleep(Math.random() * 0.5 + 0.3); // user chọn khách hàng


    // ══════════════════════════════════════════════════════════
    //  STEP 03: LẤY DANH SÁCH SẢN PHẨM
    //  Correlation: chọn ngẫu nhiên 1-3 SP để tạo đơn
    // ══════════════════════════════════════════════════════════
    group('03 - Get Products', function () {
        const payload = JSON.stringify({
            page:        0,
            size:        28,
            groupId:     null,
            isCountAll:  true,
            isBarcode:   false,
            sort:        'productId desc',
            priceListId: priceListId,
            warehouseId: warehouseId,
        });

        const res = http.post(
            `${BASE_URL}/api/client/page/product/get-with-paging2?type=1`,
            payload,
            { headers, tags: { step: 'get_products' } }
        );

        productsDuration.add(res.timings.duration);

        const ok = check(res, {
            'products: status 200': (r) => r.status === 200,
            'products: has data':   (r) => {
                try {
                    const body = JSON.parse(r.body);
                    const list = body.data || body;
                    return Array.isArray(list) && list.length > 0;
                } catch { return false; }
            },
        });

        if (!ok) {
            console.error(`[step-03] products failed [${res.status}]: ${res.body}`);
            return;
        }

        // Correlation: bỏ qua 6 SP đầu (SP mặc định, không bán được)
        // Chọn ngẫu nhiên tối đa 3 SP từ index 6 trở đi
        try {
            const body        = JSON.parse(res.body);
            const allProducts = body.data || body;
            const sellable    = allProducts.slice(6);           // bỏ 6 SP đầu
            const count     = Math.min(3, sellable.length);   // tối đa 3, lấy hết nếu không đủ
            const shuffled    = [...sellable].sort(() => 0.5 - Math.random());

            selectedProducts = shuffled.slice(0, count).map((p, idx) => {
                const qty       = Math.floor(Math.random() * 3) + 1;
                const unitPrice = p.salePrice || 0;
                const amount    = unitPrice * qty;

                // Nếu SP có batchOnHands → lọc batch có onHand > qty, chọn ngẫu nhiên 1
                let batchId = p.batchId || null;
                if (Array.isArray(p.batchOnHands) && p.batchOnHands.length > 0) {
                    const validBatches = p.batchOnHands.filter(b => b.onHand > qty);
                    if (validBatches.length > 0) {
                        const picked = validBatches[Math.floor(Math.random() * validBatches.length)];
                        batchId = picked.id;
                    }
                }

                return {
                    productId:             p.productId,
                    productProductUnitId:  p.productProductUnitId,
                    productName:           p.productName,
                    productCode:           p.productCode,
                    imageUrl:              p.imageUrl || '',
                    unit:                  p.unit,
                    unitId:                p.unitId,
                    quantity:              qty,
                    unitPrice,
                    unitPriceOrigin:       unitPrice,
                    outPriceTax:           0,
                    discountAmount:        0,
                    amount,
                    totalPreTax:           amount,
                    vatRate:               -1,
                    vatRateName:           '0%',
                    vatAmount:             0,
                    inventoryTracking:     p.inventoryTracking,
                    inventoryCount:        p.inventoryCount || 0,
                    totalAmount:           amount,
                    feature:               p.feature,
                    typeDiscount:          'Giảm theo giá trị',
                    discountRate:          0,
                    position:              idx + 1,
                    displayAmount:         amount,
                    productNameCustom:     '',
                    groupBatch:            randomKey(20),
                    discountVatRate:       null,
                    totalDiscount:         null,
                    displayVatAmount:      0,
                    displayTotalAmount:    amount,
                    voucherProducts:       [],
                    productExtra:          null,
                    warehouseId:           p.warehouseId,
                    warehouseName:         'Kho bán hàng',
                    batchId,
                    batchOnHands:          p.batchOnHands || null,
                    batchOnHandsInitial:   p.batchOnHands || null,
                    hasBatch:              p.hasBatch || 0,
                    toppings:              [],
                    combos:                [],
                    idMedicine:            p.idMedicine || '',
                    idMedicineSale:        null,
                    licensePlates:         '',
                    treatmentProducts:     [],
                    type:                  p.type || 0,
                    description:           '',
                    isImeiSerialManagement: p.isImeiSerialManagement || false,
                    imeiSerials:           [],
                    checkin:               null,
                    careerTax:             null,
                    convertRate:           p.convertRate || 1,
                    autoUpdateProductVoucher: true,
                    inputWidth:            65,
                    totalAmountTopping:    0,
                    displayAmountOriginal: amount,
                    totalAmountProduct:    amount,
                    warranties:            [],
                    selectedWarranties:    [],
                    promoValid:            false,
                    checkout:              null,
                    expiredAt:             null,
                };
            });
        } catch {}
    });

    if (selectedProducts.length === 0) {
        orderFailed.add(1);
        orderRate.add(false);
        return;
    }

    sleep(Math.random() + 1); // user xem SP và thêm vào giỏ


    // ══════════════════════════════════════════════════════════
    //  STEP 04: TẠO ĐƠN HÀNG
    // ══════════════════════════════════════════════════════════
    group('04 - Create Order', function () {
        const totalQty    = selectedProducts.reduce((s, p) => s + p.quantity, 0);
        const totalAmount = selectedProducts.reduce((s, p) => s + p.totalAmount, 0);

        const payload = JSON.stringify({
            products:    selectedProducts,
            vouchers:    [],
            comId:       comId,
            payment:     { paymentMethod: 'TM/CK' },
            deliveryType: 2,
            taxAuthorityCode: '00-00-00000-00000000000',
            billDate:    formatDateTime(new Date()),
            status:      0,
            countProduct: selectedProducts.length,
            vatRate:     -1,
            amount:      totalAmount,
            discountAmount: 0,
            totalPreTax: totalAmount,
            vatAmount:   0,
            totalAmount,
            voucherAmount: 0,
            quantity:    totalQty,
            typeInv:     0,
            checkboxVatRateDiscountProduct: false,
            vatRateDiscountProductName: '',
            haveDiscountVat: false,
            checkSPDV:   false,
            surcharges:  [],
            extraConfig: { svc5: 0 },
            billDetailResponse: false,
            extra:       { noteOnInvoice: false },
            priceListId,
            discountVatRate: 0,
            code:        `ĐH ${randomKey(6)}`,
            exciseTaxAmount: 0,
            exciseTaxRate: null,
            productDiscountAmount: 0,
            statusOrder: true,
            discountVatAmount: 0,
            productTaxAmount: 0,
            customerId,
            customerName,
            buyerName:   null,
            customerAddress: null,
            customerTaxCode: null,
            pointBalanceCustomer: 0,
            moneyBalanceCustomer: 0,
            cardCustomerInfo: null,
            totalSurcharge: 0,
            surchargeVatAmount: 0,
            uniqueKey:       uuidv4(),
            idempotencyKey:  uuidv4(),
            fkey:            randomKey(12),
            checkIn:     null,
            checkOut:    null,
        });

        const res = http.post(
            `${BASE_URL}/api/client/page/bill/create`,
            payload,
            { headers, tags: { step: 'create_order' } }
        );

        createOrderDuration.add(res.timings.duration);

        const ok = check(res, {
            'order: status 200 or 201': (r) => r.status === 200 || r.status === 201,
            'order: has id':            (r) => {
                try {
                    const body = JSON.parse(r.body);
                    return !!(body.id || body.data?.id);
                } catch { return false; }
            },
        });

        if (ok) {
            orderSuccess.add(1);
            orderRate.add(true);
        } else {
            console.error(`[step-04] create order failed: ${res.body.substring(0, 300)}, request: ${payload}`);
            orderFailed.add(1);
            orderRate.add(false);
        }
    });

    fullFlowDuration.add(Date.now() - flowStart);
    sleep(1);
}
