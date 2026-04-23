import http from 'k6/http';
import { check } from 'k6';
import {AUTH_CREDENTIALS, AUTH_ENDPOINT, BASE_URL} from '../config.js';

/**
 * Gọi API authenticate và trả về JWT token.
 * Dùng trong setup() của mỗi test để lấy token 1 lần trước khi test chạy.
 *
 * @param {Object} [credentials] - { username, password } — mặc định lấy từ config
 * @returns {string} JWT token
 */
export function authenticate(credentials) {
    const creds = credentials || AUTH_CREDENTIALS;

    const res = http.post(
        `${BASE_URL}${AUTH_ENDPOINT}`,
        JSON.stringify({ username: creds.username, password: creds.password, companyId: creds.companyId }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    const ok = check(res, {
        'auth: status 200': (r) => r.status === 200,
        'auth: has token':  (r) => {
            try { return !!JSON.parse(r.body).data.id_token; } catch { return false; }
        },
    });

    if (!ok) {
        throw new Error(`Authentication failed`);
    }

    const data = JSON.parse(res.body).data;
    return {
        token: data.id_token,
        comId: data.companyId,
    };
}
