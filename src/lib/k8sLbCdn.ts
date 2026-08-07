/**
 * Phase 40 — Kubernetes / Load Balancer / CDN generators
 * Manifests + config templates; optional kubectl apply when available.
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { WORKSPACE } from "./codeRunner.js";
import { writeWorkspaceFile } from "./fileManager.js";
import { createCheckpoint } from "./patchEngine.js";
import { log } from "./logger.js";

const DATA = join(process.cwd(), ".data");
const LOG = join(DATA, "k8s-lb-cdn-log.json");
mkdirSync(DATA, { recursive: true });

type Event = { id: string; action: string; ok: boolean; detail: string; at: string };

function pushLog(action: string, ok: boolean, detail: string) {
  let rows: Event[] = [];
  try {
    if (existsSync(LOG)) rows = JSON.parse(readFileSync(LOG, "utf8"));
  } catch {
    rows = [];
  }
  rows.unshift({
    id: randomUUID().slice(0, 8),
    action,
    ok,
    detail: detail.slice(0, 500),
    at: new Date().toISOString(),
  });
  try {
    writeFileSync(LOG, JSON.stringify(rows.slice(0, 80), null, 2));
  } catch {
    /* */
  }
}

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const t = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ code: 124, stdout, stderr: stderr + "\n[timeout]" });
    }, 45000);
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    child.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: 1, stdout: "", stderr: e.message });
    });
  });
}

export async function detectKubeTools() {
  const check = async (bin: string) => {
    const r = await run("bash", ["-lc", `command -v ${bin} >/dev/null && echo YES || echo NO`]);
    return r.stdout.includes("YES");
  };
  return {
    kubectl: await check("kubectl"),
    helm: await check("helm"),
    docker: await check("docker"),
  };
}

export async function generateK8sDeployment(opts?: {
  name?: string;
  image?: string;
  replicas?: number;
  port?: number;
}): Promise<{ files: string[] }> {
  const name = opts?.name || "ai-agent-pro";
  const image = opts?.image || "ai-agent-pro:latest";
  const replicas = opts?.replicas ?? 2;
  const port = opts?.port || 3000;
  const dir = "deploy/k8s";

  try {
    await createCheckpoint("k8s-manifests");
  } catch {
    /* */
  }

  const deployment = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  labels:
    app: ${name}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
        - name: ${name}
          image: ${image}
          ports:
            - containerPort: ${port}
          env:
            - name: PORT
              value: "${port}"
            - name: NODE_ENV
              value: production
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "1"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /api/health
              port: ${port}
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: ${port}
            initialDelaySeconds: 15
            periodSeconds: 20
`;

  const service = `apiVersion: v1
kind: Service
metadata:
  name: ${name}
spec:
  selector:
    app: ${name}
  ports:
    - port: 80
      targetPort: ${port}
  type: ClusterIP
`;

  const ingress = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ${name}
  annotations:
    kubernetes.io/ingress.class: nginx
spec:
  rules:
    - host: ${name}.local
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: ${name}
                port:
                  number: 80
`;

  const hpa = `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${name}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${name}
  minReplicas: ${replicas}
  maxReplicas: ${Math.max(replicas * 3, 6)}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`;

  await writeWorkspaceFile(`${dir}/deployment.yaml`, deployment);
  await writeWorkspaceFile(`${dir}/service.yaml`, service);
  await writeWorkspaceFile(`${dir}/ingress.yaml`, ingress);
  await writeWorkspaceFile(`${dir}/hpa.yaml`, hpa);

  const files = [
    `${dir}/deployment.yaml`,
    `${dir}/service.yaml`,
    `${dir}/ingress.yaml`,
    `${dir}/hpa.yaml`,
  ];
  pushLog("k8s_generate", true, files.join(", "));
  log("info", "K8s manifests generated", "k8s");
  return { files };
}

export async function generateLbConfig(opts?: {
  type?: "nginx" | "haproxy";
  backends?: string[];
  listenPort?: number;
}): Promise<{ path: string; content: string }> {
  const backends = opts?.backends?.length
    ? opts.backends
    : ["127.0.0.1:3000", "127.0.0.1:3001"];
  const listen = opts?.listenPort || 80;
  const type = opts?.type || "nginx";

  let path: string;
  let content: string;

  if (type === "haproxy") {
    path = "deploy/lb/haproxy.cfg";
    content = `# Generated by AI Agent Pro — Phase 40
global
  maxconn 4096

defaults
  mode http
  timeout connect 5s
  timeout client 50s
  timeout server 50s

frontend fe_http
  bind *:${listen}
  default_backend be_app

backend be_app
  balance roundrobin
${backends.map((b, i) => `  server s${i + 1} ${b} check`).join("\n")}
`;
  } else {
    path = "deploy/lb/nginx-lb.conf";
    content = `# Generated by AI Agent Pro — Phase 40
upstream app_backend {
${backends.map((b) => `    server ${b};`).join("\n")}
}

server {
    listen ${listen};
    location / {
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
`;
  }

  await writeWorkspaceFile(path, content);
  pushLog("lb_generate", true, path);
  return { path, content };
}

export async function generateCdnHints(opts?: {
  provider?: "cloudflare" | "fastly" | "generic";
  origin?: string;
  domain?: string;
}): Promise<{ path: string; content: string }> {
  const provider = opts?.provider || "cloudflare";
  const origin = opts?.origin || "origin.example.com";
  const domain = opts?.domain || "www.example.com";

  const content = `# CDN Setup Hints — Phase 40
provider: ${provider}
domain: ${domain}
origin: ${origin}

## Checklist
1. Point DNS (${domain}) to CDN
2. Origin server: ${origin} (only allow CDN IPs if possible)
3. Cache rules:
   - Cache static: /assets/*, *.js, *.css, *.png (TTL 1d+)
   - Bypass cache: /api/*, /agent/*, SSE endpoints
4. SSL: Full (strict) between CDN and origin
5. Enable gzip/brotli at CDN edge
6. WebSockets / SSE: disable buffering for /api/agent and terminal streams

## Cloudflare example (API tokens stay in Credential Broker — never in this file)
- Page Rule or Cache Rule: /api/* → Cache Level: Bypass
- SSL/TLS: Full (strict)
- Always Use HTTPS: On

## Fastly / generic
- Backend = ${origin}
- Condition: URL ~ ^/api → pass (no cache)
`;

  const path = "deploy/cdn/CDN_SETUP.md";
  await writeWorkspaceFile(path, content);
  pushLog("cdn_hints", true, path);
  return { path, content };
}

export async function kubectlApply(dir = "deploy/k8s"): Promise<{ ok: boolean; output: string }> {
  const abs = join(WORKSPACE, dir);
  if (!existsSync(abs)) {
    return { ok: false, output: "manifests not found — generate first" };
  }
  const tools = await detectKubeTools();
  if (!tools.kubectl) {
    return { ok: false, output: "kubectl not installed" };
  }
  const r = await run("kubectl", ["apply", "-f", abs]);
  const ok = r.code === 0;
  pushLog("kubectl_apply", ok, (r.stderr || r.stdout).slice(0, 300));
  return { ok, output: (r.stdout + "\n" + r.stderr).slice(0, 4000) };
}

export async function fullStackGenerate(opts?: {
  name?: string;
  image?: string;
  port?: number;
  domain?: string;
  backends?: string[];
}) {
  const k8s = await generateK8sDeployment(opts);
  const lb = await generateLbConfig({ backends: opts?.backends, type: "nginx" });
  const cdn = await generateCdnHints({ domain: opts?.domain, origin: opts?.domain || "origin.local" });
  return {
    k8s: k8s.files,
    lb: lb.path,
    cdn: cdn.path,
  };
}

export function recentK8sLog() {
  try {
    if (!existsSync(LOG)) return [];
    return JSON.parse(readFileSync(LOG, "utf8"));
  } catch {
    return [];
  }
}
