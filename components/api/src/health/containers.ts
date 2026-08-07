/**
 * Docker container inventory for System Health (INIT-0016). Queries a
 * read-only docker-socket-proxy (never the raw socket from within cast-api —
 * see docker-compose.yml) so a compromised API process can list containers
 * but never control the daemon.
 */
import { config } from "../config";

export interface ContainerInfo {
  name: string;
  service: string;
  purpose: string;
  image: string;
  state: string;
  health: "healthy" | "unhealthy" | "starting" | "none";
  status: string;
  createdAt: string;
  ports: string[];
}

const PURPOSE: Record<string, string> = {
  api: "CAST API — Express backend: auth, ConnectWise integration, vessel sync, secret store.",
  web: "CAST Web — nginx serving the SPA and TLS-terminating reverse proxy for /api.",
  "docker-proxy": "Docker Socket Proxy — read-only container introspection for this page. No control access to the daemon.",
};

interface DockerApiContainer {
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
  Ports: { IP?: string; PublicPort?: number; PrivatePort: number; Type: string }[];
  Labels: Record<string, string>;
}

function parseHealth(status: string): ContainerInfo["health"] {
  const m = /\((healthy|unhealthy|starting)\)/i.exec(status);
  return m ? (m[1].toLowerCase() as ContainerInfo["health"]) : "none";
}

function formatPorts(ports: DockerApiContainer["Ports"]): string[] {
  return ports.map((p) =>
    p.PublicPort ? `${p.IP ?? "0.0.0.0"}:${p.PublicPort}->${p.PrivatePort}/${p.Type}` : `${p.PrivatePort}/${p.Type}`,
  );
}

export async function getContainers(): Promise<ContainerInfo[]> {
  const res = await fetch(`${config.dockerProxyUrl}/containers/json?all=1`, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`docker-proxy returned ${res.status}`);
  const raw = (await res.json()) as DockerApiContainer[];
  return raw
    .map((c) => {
      const name = c.Names[0]?.replace(/^\//, "") ?? "unknown";
      const service = c.Labels?.["com.docker.compose.service"] ?? name;
      return {
        name,
        service,
        purpose: PURPOSE[service] ?? "No description recorded for this service.",
        image: c.Image,
        state: c.State,
        health: parseHealth(c.Status),
        status: c.Status,
        createdAt: new Date(c.Created * 1000).toISOString(),
        ports: formatPorts(c.Ports ?? []),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
