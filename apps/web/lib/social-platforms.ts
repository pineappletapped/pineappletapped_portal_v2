import 'server-only';

import { randomUUID } from 'crypto';

import { createSecretConfig, readSecretValue } from './secret-manager';

export type SocialPlatform =
  | 'youtube'
  | 'linkedin'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'twitter'
  | 'vimeo';

export interface RequestedScopes {
  publish: boolean;
  analytics: boolean;
}

export interface PlatformCredentials {
  clientId: string | null;
  clientSecret: string | null;
}

export interface AuthorizationUrlResult {
  url: string;
  usedMock: boolean;
}

export interface TokenExchangeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string | null;
  platformAccountId: string | null;
  platformAccountName: string | null;
  raw: Record<string, unknown>;
}

interface OAuthPlatformConfig {
  key: SocialPlatform;
  label: string;
  authorizeUrl: string | null;
  tokenUrl: string | null;
  scopeSeparator: string;
  defaultScopes: string[];
  publishScopes: string[];
  analyticsScopes: string[];
  authorizeParams?: Record<string, string>;
  tokenParams?: Record<string, string>;
  clientIdSecretEnv?: string;
  clientIdEnv?: string;
  clientSecretSecretEnv?: string;
  clientSecretEnv?: string;
}

const PLATFORM_CONFIGS: Record<SocialPlatform, OAuthPlatformConfig> = {
  youtube: {
    key: 'youtube',
    label: 'YouTube',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopeSeparator: ' ',
    defaultScopes: ['https://www.googleapis.com/auth/userinfo.email'],
    publishScopes: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube',
    ],
    analyticsScopes: ['https://www.googleapis.com/auth/yt-analytics.readonly'],
    authorizeParams: {
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      response_type: 'code',
    },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_YOUTUBE_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_YOUTUBE_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_YOUTUBE_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_YOUTUBE_CLIENT_SECRET',
  },
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopeSeparator: ' ',
    defaultScopes: ['r_emailaddress'],
    publishScopes: ['w_member_social'],
    analyticsScopes: ['r_organization_social'],
    authorizeParams: { response_type: 'code' },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_LINKEDIN_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_LINKEDIN_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_LINKEDIN_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_LINKEDIN_CLIENT_SECRET',
  },
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    authorizeUrl: 'https://api.instagram.com/oauth/authorize',
    tokenUrl: 'https://api.instagram.com/oauth/access_token',
    scopeSeparator: ' ',
    defaultScopes: ['user_profile'],
    publishScopes: ['user_media'],
    analyticsScopes: ['instagram_graph_user_media'],
    authorizeParams: { response_type: 'code' },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_INSTAGRAM_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_INSTAGRAM_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_INSTAGRAM_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_INSTAGRAM_CLIENT_SECRET',
  },
  facebook: {
    key: 'facebook',
    label: 'Facebook Pages',
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scopeSeparator: ',',
    defaultScopes: ['email', 'pages_show_list'],
    publishScopes: ['pages_manage_posts', 'pages_read_engagement'],
    analyticsScopes: ['pages_read_user_content'],
    authorizeParams: { response_type: 'code' },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_FACEBOOK_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_FACEBOOK_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_FACEBOOK_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_FACEBOOK_CLIENT_SECRET',
  },
  tiktok: {
    key: 'tiktok',
    label: 'TikTok',
    authorizeUrl: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    scopeSeparator: ' ',
    defaultScopes: ['user.info.basic'],
    publishScopes: ['video.publish'],
    analyticsScopes: ['video.list'],
    authorizeParams: { response_type: 'code' },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_TIKTOK_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_TIKTOK_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_TIKTOK_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_TIKTOK_CLIENT_SECRET',
  },
  twitter: {
    key: 'twitter',
    label: 'X (Twitter)',
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    scopeSeparator: ' ',
    defaultScopes: ['tweet.read', 'users.read'],
    publishScopes: ['tweet.write'],
    analyticsScopes: ['offline.access'],
    authorizeParams: { response_type: 'code' },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_TWITTER_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_TWITTER_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_TWITTER_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_TWITTER_CLIENT_SECRET',
  },
  vimeo: {
    key: 'vimeo',
    label: 'Vimeo',
    authorizeUrl: 'https://api.vimeo.com/oauth/authorize',
    tokenUrl: 'https://api.vimeo.com/oauth/access_token',
    scopeSeparator: ' ',
    defaultScopes: ['public'],
    publishScopes: ['upload'],
    analyticsScopes: ['video_files'],
    authorizeParams: { response_type: 'code' },
    tokenParams: { grant_type: 'authorization_code' },
    clientIdSecretEnv: 'SOCIAL_VIMEO_CLIENT_ID_SECRET_NAME',
    clientIdEnv: 'SOCIAL_VIMEO_CLIENT_ID',
    clientSecretSecretEnv: 'SOCIAL_VIMEO_CLIENT_SECRET_SECRET_NAME',
    clientSecretEnv: 'SOCIAL_VIMEO_CLIENT_SECRET',
  },
};

const credentialCache = new Map<SocialPlatform, PlatformCredentials>();

function normaliseScopes(scopes: RequestedScopes | null | undefined): RequestedScopes {
  return {
    publish: scopes?.publish === true,
    analytics: scopes?.analytics === true,
  };
}

function resolveScopeList(platform: SocialPlatform, requested: RequestedScopes): string[] {
  const config = PLATFORM_CONFIGS[platform];
  const result = new Set<string>(config.defaultScopes);
  if (requested.publish) {
    config.publishScopes.forEach((scope) => result.add(scope));
  }
  if (requested.analytics) {
    config.analyticsScopes.forEach((scope) => result.add(scope));
  }
  return Array.from(result).filter((scope) => scope.trim().length > 0);
}

async function loadPlatformCredential(
  secretEnv: string | undefined,
  fallbackEnv: string | undefined,
  label: string
): Promise<string | null> {
  const secretName = secretEnv ? process.env[secretEnv] : undefined;
  const fallback = fallbackEnv ? process.env[fallbackEnv] : undefined;
  const config = createSecretConfig(secretName ?? null, fallback ?? null, label);
  return readSecretValue(config);
}

export function getPlatformLabel(platform: SocialPlatform): string {
  return PLATFORM_CONFIGS[platform].label;
}

export async function getPlatformCredentials(platform: SocialPlatform): Promise<PlatformCredentials> {
  const cached = credentialCache.get(platform);
  if (cached) {
    return cached;
  }
  const config = PLATFORM_CONFIGS[platform];
  const [clientId, clientSecret] = await Promise.all([
    loadPlatformCredential(config.clientIdSecretEnv, config.clientIdEnv, `${config.label} OAuth client ID`).catch(() => null),
    loadPlatformCredential(
      config.clientSecretSecretEnv,
      config.clientSecretEnv,
      `${config.label} OAuth client secret`
    ).catch(() => null),
  ]);

  const credentials: PlatformCredentials = {
    clientId: clientId ?? null,
    clientSecret: clientSecret ?? null,
  };
  credentialCache.set(platform, credentials);
  return credentials;
}

function buildMockAuthorizationUrl(callback: string, state: string): AuthorizationUrlResult {
  const url = new URL(callback);
  url.searchParams.set('state', state);
  url.searchParams.set('code', `mock-${randomUUID()}`);
  url.searchParams.set('mock', '1');
  return { url: url.toString(), usedMock: true };
}

export async function buildAuthorizationUrl(
  platform: SocialPlatform,
  callbackUri: string,
  state: string,
  scopes?: RequestedScopes
): Promise<AuthorizationUrlResult> {
  const config = PLATFORM_CONFIGS[platform];
  const credentials = await getPlatformCredentials(platform);
  if (!config.authorizeUrl || !credentials.clientId) {
    return buildMockAuthorizationUrl(callbackUri, state);
  }

  const requestedScopes = resolveScopeList(platform, normaliseScopes(scopes));
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUri,
    state,
  });

  const responseType = config.authorizeParams?.response_type ?? 'code';
  params.set('response_type', responseType);

  if (requestedScopes.length > 0) {
    params.set('scope', requestedScopes.join(config.scopeSeparator));
  }

  if (config.authorizeParams) {
    Object.entries(config.authorizeParams).forEach(([key, value]) => {
      if (key === 'response_type') {
        return;
      }
      params.set(key, value);
    });
  }

  return {
    url: `${config.authorizeUrl}?${params.toString()}`,
    usedMock: false,
  };
}

export async function exchangeAuthorizationCode(
  platform: SocialPlatform,
  code: string,
  callbackUri: string
): Promise<TokenExchangeResult> {
  const config = PLATFORM_CONFIGS[platform];
  const credentials = await getPlatformCredentials(platform);

  if (!config.tokenUrl || !credentials.clientId || !credentials.clientSecret) {
    const mockToken = {
      accessToken: `mock-${platform}-${code}-${randomUUID()}`,
      refreshToken: `mock-refresh-${platform}-${randomUUID()}`,
      expiresIn: 3600,
      scope: resolveScopeList(platform, normaliseScopes({ publish: true, analytics: true })).join(
        config.scopeSeparator
      ),
      tokenType: 'Bearer',
      platformAccountId: null,
      platformAccountName: null,
      raw: { mock: true, code },
    } satisfies TokenExchangeResult;
    return mockToken;
  }

  const params = new URLSearchParams({
    code,
    redirect_uri: callbackUri,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
  });

  if (config.tokenParams) {
    Object.entries(config.tokenParams).forEach(([key, value]) => {
      params.set(key, value);
    });
  }

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => null);
    throw new Error(
      `Failed to exchange authorization code for ${config.label}: ${response.status} ${
        errorText || response.statusText
      }`
    );
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : null;
  if (!accessToken) {
    throw new Error(`Authorization response for ${config.label} did not include an access token.`);
  }

  const expiresRaw = payload.expires_in;
  const expiresIn =
    typeof expiresRaw === 'number'
      ? expiresRaw
      : typeof expiresRaw === 'string'
      ? Number.parseInt(expiresRaw, 10)
      : null;

  const refreshToken =
    typeof payload.refresh_token === 'string' && payload.refresh_token.trim().length > 0
      ? payload.refresh_token
      : null;

  const scope = typeof payload.scope === 'string' ? payload.scope : null;
  const tokenType = typeof payload.token_type === 'string' ? payload.token_type : 'Bearer';

  return {
    accessToken,
    refreshToken,
    expiresIn: Number.isFinite(expiresIn) ? (expiresIn as number) : null,
    scope,
    tokenType,
    platformAccountId: typeof payload.account_id === 'string' ? payload.account_id : null,
    platformAccountName: typeof payload.account_name === 'string' ? payload.account_name : null,
    raw: payload,
  };
}
