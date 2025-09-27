import 'server-only';

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

interface SecretConfig {
  /** Fully-qualified secret resource name, e.g. `projects/123/secrets/my-secret`. */
  resource?: string | null;
  /** Fallback environment variable for local development. */
  fallbackEnv?: string | null;
  /** Optional label used in error messages. */
  label?: string;
}

interface ParsedSecretResource {
  parent: string;
  versionName: string;
}

let cachedClient: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new SecretManagerServiceClient();
  return cachedClient;
}

function parseSecretResource(resource: string): ParsedSecretResource {
  const trimmed = resource.trim().replace(/\s+/g, '');
  if (!trimmed) {
    throw new Error('Secret resource name cannot be empty.');
  }
  if (!trimmed.startsWith('projects/')) {
    throw new Error(`Secret resource must start with "projects/". Received: ${resource}`);
  }
  if (trimmed.includes('/versions/')) {
    const [parent, version] = trimmed.split('/versions/');
    const versionName = version && version.length > 0 ? version : 'latest';
    return { parent, versionName: `${parent}/versions/${versionName}` };
  }
  return { parent: trimmed, versionName: `${trimmed}/versions/latest` };
}

function normaliseValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function readSecretValue(config: SecretConfig): Promise<string | null> {
  const fallback = normaliseValue(config.fallbackEnv);
  if (!config.resource) {
    return fallback;
  }

  const { versionName } = parseSecretResource(config.resource);
  try {
    const client = getClient();
    const [response] = await client.accessSecretVersion({ name: versionName });
    const data = response.payload?.data;
    if (!data || data.length === 0) {
      return null;
    }
    const decoded = Buffer.from(data).toString('utf8').trim();
    return decoded.length > 0 ? decoded : null;
  } catch (error) {
    if ((error as { code?: number }).code === 5) {
      // NotFound
      return fallback;
    }
    const label = config.label ?? config.resource;
    throw new Error(`Unable to read ${label} from Secret Manager: ${(error as Error).message}`);
  }
}

export async function writeSecretValue(config: SecretConfig, value: string | null): Promise<void> {
  if (!config.resource) {
    const label = config.label ?? 'secret';
    throw new Error(
      `${label} is managed via environment variables. Update it in infrastructure instead of the admin UI.`
    );
  }
  const { parent } = parseSecretResource(config.resource);
  const payload = value ? value.trim() : '';
  try {
    const client = getClient();
    await client.addSecretVersion({ parent, payload: { data: Buffer.from(payload, 'utf8') } });
  } catch (error) {
    const label = config.label ?? config.resource;
    throw new Error(`Unable to store ${label} in Secret Manager: ${(error as Error).message}`);
  }
}

export function createSecretConfig(
  resource: string | null | undefined,
  fallbackEnv: string | null | undefined,
  label: string
): SecretConfig {
  return {
    resource: normaliseValue(resource),
    fallbackEnv: normaliseValue(fallbackEnv),
    label,
  };
}
