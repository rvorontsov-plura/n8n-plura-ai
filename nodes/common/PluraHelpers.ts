import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export type N8nCtx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

export type PluraCreds = {
	authMethod?: 'login' | 'apiKey';
	apiKey?: string;
	email?: string;
	password?: string;
	bearerToken?: string; // JWT token from login
	integrationsBaseUrl?: string;
	pluraApiBaseUrl?: string;
};

export function stripTrailingSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

export async function getPluraCreds(ctx: N8nCtx): Promise<PluraCreds> {
	const raw = (await ctx.getCredentials('pluraAiAutomationsApi')) as Record<string, unknown>;
	return {
		authMethod: (raw.authMethod as 'login' | 'apiKey') || 'login',
		apiKey: String(raw.apiKey || '').trim() || undefined,
		email: String(raw.email || '').trim() || undefined,
		password: String(raw.password || '').trim() || undefined,
		bearerToken: String(raw.bearerToken || '').trim() || undefined,
		integrationsBaseUrl: String(raw.integrationsBaseUrl || '').trim() || undefined,
		pluraApiBaseUrl: String(raw.pluraApiBaseUrl || '').trim() || undefined,
	};
}

export function getIntegrationsBaseUrl(creds: PluraCreds): string {
	return stripTrailingSlash(creds.integrationsBaseUrl || 'https://integrations.plura.ai/api');
}

export function getPluraApiBaseUrl(creds: PluraCreds): string {
	return stripTrailingSlash(creds.pluraApiBaseUrl || 'https://api.plura.ai/v1');
}

export async function requestJson<T = unknown>(
	ctx: N8nCtx,
	options: {
		method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
		url: string;
		qs?: Record<string, string | number | boolean | undefined>;
		body?: unknown;
		headers?: Record<string, string>;
	},
): Promise<T> {
	try {
		const resp = await ctx.helpers.request({
			method: options.method,
			url: options.url,
			qs: options.qs,
			body: options.body,
			headers: options.headers,
			json: true,
		});
		return resp as T;
	} catch (error) {
		// Preserve n8n's rich request error details (statusCode, body, etc.)
		throw new NodeApiError(ctx.getNode(), error as any);
	}
}

/**
 * Get API key for Plura API calls.
 * Priority: Direct API key > Bearer token (for workspace API key lookup) > Email/Password login
 */
export async function getApiKeyOrThrow(ctx: N8nCtx): Promise<string> {
	const creds = await getPluraCreds(ctx);

	// 1) If API key is provided directly, use it
	if (creds.apiKey && creds.authMethod === 'apiKey') {
		return creds.apiKey;
	}

	// 2) If bearer token is available (from login), use it to fetch workspace API key
	let jwt = creds.bearerToken;

	// 3) If no bearer token but email/password provided, authenticate to get JWT
	if (!jwt && creds.email && creds.password) {
		const auth = await requestJson<{ status?: string; token?: string }>(ctx, {
			method: 'POST',
			url: 'https://plura-lb.gynetix.com/backend/api/user/Authenticate.json',
			headers: { 'Content-Type': 'application/json' },
			body: { user: creds.email, password: creds.password },
		});

		jwt = auth?.token;
		if (!jwt) {
			throw new NodeOperationError(ctx.getNode(), 'Plura authentication failed: missing token');
		}
	}

	if (!jwt) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Missing credentials. Provide an API Key, or Email + Password to login and get a bearer token.',
		);
	}

	// 4) Get first workspace
	const workspaces = await requestJson<Array<{ workspace_id: string }>>(ctx, {
		method: 'GET',
		url: 'https://plura-lb.gynetix.com/backend/api/user/Workspaces.json',
		headers: { accept: '*/*', Authorization: `Bearer ${jwt}` },
	});

	const workspaceId = Array.isArray(workspaces) && workspaces.length ? workspaces[0].workspace_id : '';
	if (!workspaceId) {
		throw new NodeOperationError(ctx.getNode(), 'No workspaces available for this account');
	}

	// 5) Get API key for workspace
	const apiKeyResp = await requestJson<{ items?: Array<{ api_key?: string }> }>(ctx, {
		method: 'GET',
		url: 'https://plura-lb.gynetix.com/backend/api/user/ApiKey.json',
		qs: { workspace_id: workspaceId, limit: 30, page: 1 },
		headers: { accept: '*/*', Authorization: `Bearer ${jwt}` },
	});

	const apiKey =
		apiKeyResp?.items && apiKeyResp.items.length ? String(apiKeyResp.items[0].api_key || '').trim() : '';
	if (!apiKey) {
		throw new NodeOperationError(ctx.getNode(), 'No API key found for the first workspace');
	}

	return apiKey;
}

/**
 * Get JWT bearer token for Plura backend API calls (workspaces, journeys, flows, etc.)
 * Uses stored bearer token if available, otherwise authenticates with email/password
 */
export async function getBearerTokenOrThrow(ctx: N8nCtx): Promise<string> {
	const creds = await getPluraCreds(ctx);

	// If bearer token is already stored, use it
	if (creds.bearerToken) {
		return creds.bearerToken;
	}

	// Otherwise, authenticate with email/password
	if (!creds.email || !creds.password) {
		throw new NodeOperationError(
			ctx.getNode(),
			'Missing credentials. Provide Email + Password to login, or set a Bearer Token directly.',
		);
	}

	const auth = await requestJson<{ status?: string; token?: string }>(ctx, {
		method: 'POST',
		url: 'https://plura-lb.gynetix.com/backend/api/user/Authenticate.json',
		headers: { 'Content-Type': 'application/json' },
		body: { user: creds.email, password: creds.password },
	});

	const jwt = auth?.token;
	if (!jwt || auth.status !== 'success') {
		throw new NodeOperationError(ctx.getNode(), 'Plura authentication failed: invalid credentials');
	}

	return jwt;
}

export function parseOptionalJson(
	ctx: N8nCtx,
	value: unknown,
	errorMessage: string,
): Record<string, unknown> | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value === 'object') return value as Record<string, unknown>;
	if (typeof value !== 'string') {
		throw new NodeOperationError(ctx.getNode(), errorMessage);
	}
	try {
		return JSON.parse(value) as Record<string, unknown>;
	} catch {
		throw new NodeOperationError(ctx.getNode(), errorMessage);
	}
}

export function normalizePhone(phone: string): string {
	return String(phone || '').replace(/[^0-9]/g, '');
}

export function getPhoneVariants(phone: string): string[] {
	if (!phone) return [];
	const trimmed = String(phone).trim();
	const noPlus = trimmed.startsWith('+') ? trimmed.substring(1) : trimmed;
	const noSpecial = noPlus.replace(/[^0-9]/g, '');
	const variants = [trimmed];
	if (!variants.includes(noPlus)) variants.push(noPlus);
	if (!variants.includes(noSpecial)) variants.push(noSpecial);
	return variants.filter((v, i, self) => v && self.indexOf(v) === i);
}
