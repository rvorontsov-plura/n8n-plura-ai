import type {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export type N8nCtx = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions | IWebhookFunctions;

export type PluraCreds = {
	apiKey?: string;
	email?: string;
	password?: string;
};

export async function getPluraCreds(ctx: N8nCtx): Promise<PluraCreds> {
	const raw = (await ctx.getCredentials('pluraAiAutomationsApi')) as Record<string, unknown>;
	return {
		apiKey: String(raw.apiKey || '').trim() || undefined,
		email: String(raw.email || '').trim() || undefined,
		password: String(raw.password || '').trim() || undefined,
	};
}

export function getIntegrationsBaseUrl(): string {
	return 'https://integrations.plura.ai/api';
}

export function getPluraApiBaseUrl(): string {
	return 'https://api.plura.ai/v1';
}

async function httpRequestJson<T = unknown>(
	ctx: N8nCtx,
	options: {
		method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
		url: string;
		qs?: Record<string, string | number | boolean | undefined>;
		body?: unknown;
		headers?: Record<string, string>;
	},
	useAuthentication: boolean,
): Promise<T> {
	const requestOptions = {
		method: options.method,
		url: options.url,
		qs: options.qs,
		body: options.body as
			| string
			| Buffer
			| Record<string, unknown>
			| unknown[]
			| URLSearchParams
			| undefined,
		headers: options.headers,
		json: true,
	};
	try {
		const resp = useAuthentication
			? await ctx.helpers.httpRequestWithAuthentication.call(ctx, 'pluraAiAutomationsApi', requestOptions)
			: await ctx.helpers.httpRequest(requestOptions);
		return resp as T;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const errorOptions =
			error && typeof error === 'object' && 'httpCode' in error
				? { httpCode: (error as { httpCode?: number }).httpCode }
				: undefined;
		throw new NodeApiError(ctx.getNode(), { message: errorMessage, ...errorOptions });
	}
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
	return httpRequestJson(ctx, options, true);
}

export async function requestJsonManual<T = unknown>(
	ctx: N8nCtx,
	options: {
		method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
		url: string;
		qs?: Record<string, string | number | boolean | undefined>;
		body?: unknown;
		headers?: Record<string, string>;
	},
): Promise<T> {
	return httpRequestJson(ctx, options, false);
}

export async function requestJsonWithAuthentication<T = unknown>(
	ctx: N8nCtx,
	options: {
		method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
		url: string;
		qs?: Record<string, string | number | boolean | undefined>;
		body?: unknown;
		headers?: Record<string, string>;
	},
): Promise<T> {
	return httpRequestJson(ctx, options, true);
}

export async function getApiKeyOrThrow(ctx: N8nCtx): Promise<string> {
	const creds = await getPluraCreds(ctx);

	if (creds.apiKey) return creds.apiKey;

	let jwt: string | undefined;
	if (creds.email && creds.password) {
		const auth = await requestJsonManual<{ status?: string; token?: string }>(ctx, {
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
		throw new NodeOperationError(ctx.getNode(), 'Missing credentials. Provide an API Key, or Email + Password.');
	}

	const workspaces = await requestJsonManual<Array<{ workspace_id: string }>>(ctx, {
		method: 'GET',
		url: 'https://plura-lb.gynetix.com/backend/api/user/Workspaces.json',
		headers: { accept: '*/*', Authorization: `Bearer ${jwt}` },
	});

	const workspaceId = Array.isArray(workspaces) && workspaces.length ? workspaces[0].workspace_id : '';
	if (!workspaceId) {
		throw new NodeOperationError(ctx.getNode(), 'No workspaces available for this account');
	}

	const apiKeyResp = await requestJsonManual<{ items?: Array<{ api_key?: string }> }>(ctx, {
		method: 'GET',
		url: 'https://plura-lb.gynetix.com/backend/api/user/ApiKey.json',
		qs: { workspace_id: workspaceId, limit: 30, page: 1 },
		headers: { accept: '*/*', Authorization: `Bearer ${jwt}` },
	});

	const apiKey = apiKeyResp?.items?.[0]?.api_key?.trim() || '';
	if (!apiKey) {
		throw new NodeOperationError(ctx.getNode(), 'No API key found for the first workspace');
	}

	return apiKey;
}

export async function getBearerTokenOrThrow(ctx: N8nCtx): Promise<string> {
	const creds = await getPluraCreds(ctx);

	if (!creds.email || !creds.password) {
		throw new NodeOperationError(ctx.getNode(), 'Missing credentials. Provide Email + Password.');
	}

	const auth = await requestJsonManual<{ status?: string; token?: string }>(ctx, {
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

function leadsMatch(
	lead: Record<string, unknown>,
	record: Record<string, unknown>,
): boolean {
	const leadPhone = normalizePhone(String(lead.phone || ''));
	const recordPhone = normalizePhone(String(record.phone || ''));
	if (leadPhone && recordPhone && leadPhone === recordPhone) {
		return true;
	}

	if (
		lead.email &&
		record.email &&
		String(lead.email).toLowerCase().trim() === String(record.email).toLowerCase().trim()
	) {
		return true;
	}

	if (
		lead.first_name &&
		record.first_name &&
		lead.last_name &&
		record.last_name &&
		String(lead.first_name).toLowerCase().trim() === String(record.first_name).toLowerCase().trim() &&
		String(lead.last_name).toLowerCase().trim() === String(record.last_name).toLowerCase().trim()
	) {
		return true;
	}

	return false;
}

export async function getFirstWorkspaceId(ctx: N8nCtx, jwt: string): Promise<string | null> {
	try {
		const workspaces = await requestJsonManual<Array<{ workspace_id: string }>>(ctx, {
			method: 'GET',
			url: 'https://plura-lb.gynetix.com/backend/api/user/Workspaces.json',
			headers: { accept: '*/*', Authorization: `Bearer ${jwt}` },
		});

		if (Array.isArray(workspaces) && workspaces.length > 0) {
			return workspaces[0].workspace_id;
		}
		return null;
	} catch {
		return null;
	}
}

export async function searchLeadViaWorkspace(
	ctx: N8nCtx,
	phone: string,
	record?: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
	const creds = await getPluraCreds(ctx);

	if (!creds.email || !creds.password) {
		return null;
	}

	let jwt: string;
	try {
		jwt = await getBearerTokenOrThrow(ctx);
	} catch {
		return null;
	}

	const workspaceId = await getFirstWorkspaceId(ctx, jwt);
	if (!workspaceId) {
		return null;
	}

	const variants = getPhoneVariants(phone);

	const fetchWorkspaceLeads = async (params: Record<string, unknown> = {}): Promise<Array<Record<string, unknown>>> => {
		try {
			const resp = await requestJsonManual<{ status?: string; items?: Array<Record<string, unknown>> }>(ctx, {
				method: 'GET',
				url: 'https://plura-lb.gynetix.com/backend/api/user/WorkspaceInboxSearch.json',
				qs: {
					workspace_id: workspaceId,
					tag_matching: 'AND',
					responders_only: false,
					limit: 50,
					page: 1,
					...params,
				} as Record<string, string | number | boolean | undefined>,
				headers: { accept: '*/*', Authorization: `Bearer ${jwt}` },
			});
			return resp?.status === 'success' && Array.isArray(resp.items) ? resp.items : [];
		} catch {
			return [];
		}
	};

	for (const variant of variants) {
		const items = await fetchWorkspaceLeads({ phone: variant, limit: 1 });
		if (items.length > 0 && items[0].lead_id) return items[0];
	}

	const items = await fetchWorkspaceLeads({ page: 1, limit: 50 });
	const match = items.find((lead) => leadsMatch(lead, { phone, ...(record || {}) }));
	return match?.lead_id ? match : null;
}
