import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const uploadResponseTime = new Trend('upload_response_time');
const errorRate = new Rate('error_rate');
const timeoutCount = new Counter('timeout_count');
const successCount = new Counter('upload_success');
const failCount = new Counter('upload_fail');

//rutas de los DICOM del lote
const dicomPaths = new SharedArray('dicom_paths', function () {
    return open('/home/ubuntu/docsSantiago/k6files/lista_archivos.txt')
        .split('\n')
        .map(p => p.trim())
        .filter(Boolean);
});

const dicomFiles = dicomPaths.map(path => open(path, 'b'));
export const options = {
    scenarios: {
        carga_dicom: {
            executor: 'shared-iterations',
            vus: Number(__ENV.VUS || 10),
            iterations: dicomFiles.length,
            maxDuration: '30m',
        },
    },
    thresholds: {
        upload_response_time: ['p(95)<5000'],
        error_rate: ['rate<0.05'],
        timeout_count: ['count<10'],
    },
};
const BASE_URL = 'http://tfm-sch.imaging.i3m.upv.es';
const CLIENT_ID = 'orthanc';
const CLIENT_SECRET = 'lxHGTVUZGx8lh3QVUy02G2cs94urM8RJ';
const USERNAME = 'admin';
const PASSWORD = 'admin';
const TIMEOUT = '30s';
function getToken() {
    const response = http.post(
        `${BASE_URL}/keycloak/realms/orthanc/protocol/openid-connect/token`,
        {
            grant_type: 'password',
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            username: USERNAME,
            password: PASSWORD,
        },
        {
            timeout: TIMEOUT,
        }
    );

    if (response.status !== 200) {

        throw new Error(`No se pudo obtener el token: ${response.body}`);

    }

    return JSON.parse(response.body).access_token;

}

export function setup() {
    const token = getToken();
    console.log(`Archivos del lote: ${dicomFiles.length}`);
    return { token };

}

export default function (data) {
    const index = exec.scenario.iterationInTest;
    const filePath = dicomPaths[index];
    const file = dicomFiles[index]; 
    const start = Date.now();

    const response = http.post(
        `${BASE_URL}/orthanc/instances`,
        file,
        {
            headers: {
                Authorization: `Bearer ${data.token}`,
                'Content-Type': 'application/dicom',
            },
            timeout: TIMEOUT,
        }
    );
    uploadResponseTime.add(Date.now() - start);
    const ok = check(response, {
        'upload DICOM ok': (r) => r.status === 200,
        'tiempo upload < 10s': (r) => r.timings.duration < 10000,
    });
    if (ok) {
        successCount.add(1);
        errorRate.add(0);
    } else {
        failCount.add(1);
        errorRate.add(1);
        if (response.status === 0) {
            timeoutCount.add(1);
        }
            console.error(`
		==========================================================
		ERROR AL SUBIR DICOM
		Iteración : ${index}
		Archivo   : ${filePath}
		Estado    : ${response.status}
		Tiempo    : ${response.timings.duration} ms
		Headers   : ${JSON.stringify(response.headers)}
		Body      : ${response.body}
		Respuesta : ${response.body}
		==========================================================
	`);
    }

}
