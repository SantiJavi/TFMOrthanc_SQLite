import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const uploadResponseTime = new Trend('upload_response_time');
const errorRate          = new Rate('error_rate');
const timeoutCount       = new Counter('timeout_count');
const successCount       = new Counter('upload_success');
const failCount          = new Counter('upload_fail');

const dicomPaths = new SharedArray('dicom_paths', function () {
  return open('/home/ubuntu/docsSantiago/k6files/dicom_sample.txt')
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
});

const dicomFiles = dicomPaths.map(path => open(path, 'b'));

export const options = {
  stages: [
    { duration: '1m',  target: 5   },
    { duration: '2m',  target: 5   },
    { duration: '1m',  target: 10  },
    { duration: '2m',  target: 10  },
    { duration: '1m',  target: 20  },
    { duration: '2m',  target: 20  },
    { duration: '1m',  target: 30  },
    { duration: '2m',  target: 30  },
    { duration: '1m',  target: 50  },
    { duration: '2m',  target: 50  },
    { duration: '1m',  target: 75  },
    { duration: '2m',  target: 75  },
    { duration: '1m',  target: 100 },
    { duration: '2m',  target: 100 },
    { duration: '1m',  target: 0   },
  ],
  thresholds: {
    'upload_response_time': ['p(95)<5000'],
    'error_rate':           ['rate<0.05'],
    'timeout_count':        ['count<10'],
  },
};

const BASE_URL      = 'http://tfm-sch.imaging.i3m.upv.es';
const CLIENT_ID     = 'orthanc';
const CLIENT_SECRET = 'lxHGTVUZGx8lh3QVUy02G2cs94urM8RJ';
const USERNAME      = 'admin';
const PASSWORD      = 'admin';
const TIMEOUT       = '30s';

function getToken() {
  const response = http.post(
    `${BASE_URL}/keycloak/realms/orthanc/protocol/openid-connect/token`,
    {
      grant_type:    'password',
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      username:      USERNAME,
      password:      PASSWORD,
    },
    { timeout: TIMEOUT }
  );

  if (response.status !== 200) {
    console.error('Error obteniendo token:', response.body);
    return null;
  }

  return JSON.parse(response.body).access_token;
}

export function setup() {
  const token = getToken();
  console.log(`Token listo. Archivos DICOM cargados: ${dicomFiles.length}`);
  return { token };
}

function uploadDICOM(token) {
  const randomFile = dicomFiles[
    Math.floor(Math.random() * dicomFiles.length)
  ];

  const start = Date.now();
  const r = http.post(
    `${BASE_URL}/orthanc/instances`,
    randomFile,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/dicom',
      },
      timeout: TIMEOUT,
    }
  );
  uploadResponseTime.add(Date.now() - start);

  const ok = check(r, {
    'upload DICOM ok':     (r) => r.status === 200,
    'tiempo upload < 10s': (r) => r.timings.duration < 10000,
  });

  if (!ok) {
    errorRate.add(1);
    failCount.add(1);
    if (r.status === 0) timeoutCount.add(1);
    console.error(`Upload fallido: status=${r.status} body=${r.body}`);
  } else {
    errorRate.add(0);
    successCount.add(1);
  }
}

export default function (data) {
  if (!data.token) { sleep(1); return; }
  uploadDICOM(data.token);
  sleep(1);
}
