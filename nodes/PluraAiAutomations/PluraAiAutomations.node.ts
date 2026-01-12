import type {
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	getApiKeyOrThrow,
	getIntegrationsBaseUrl,
	getPhoneVariants,
	getPluraApiBaseUrl,
	getPluraCreds,
	parseOptionalJson,
	requestJson,
	searchLeadViaWorkspace,
} from '../common/PluraHelpers';

type Lead = Record<string, any> & { lead_id?: string };

async function pluraApiRequest<T>(
	ctx: IExecuteFunctions | ILoadOptionsFunctions,
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	path: string,
	opts: { qs?: Record<string, any>; body?: any } = {},
): Promise<T> {
	const creds = await getPluraCreds(ctx);
	const apiKey = await getApiKeyOrThrow(ctx);
	const baseUrl = getPluraApiBaseUrl(creds);
	return requestJson<T>(ctx, {
		method,
		url: `${baseUrl}${path}`,
		qs: opts.qs,
		body: opts.body,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			...(method === 'POST' || method === 'PATCH' ? { 'Content-Type': 'application/json' } : {}),
		},
	});
}

async function findLeadByPhone(
	ctx: IExecuteFunctions,
	phone: string,
	record?: Record<string, unknown>,
): Promise<Lead | null> {
	const variants = getPhoneVariants(phone);
	const lookups = variants.map(async (variant) => {
		try {
			const res = await pluraApiRequest<Lead>(ctx, 'GET', '/lead/get', { qs: { phone: variant } });
			return res && res.lead_id ? res : null;
		} catch {
			return null;
		}
	});
	const results = await Promise.all(lookups);
	const found = results.find((r) => r && r.lead_id) || null;
	if (found) return found;

	try {
		const fallback = await searchLeadViaWorkspace(ctx, phone, record);
		if (fallback && fallback.lead_id) return fallback as Lead;
	} catch {
		// Ignore workspace search failures
	}

	return null;
}

async function updateLeadById(
	ctx: IExecuteFunctions,
	leadId: string,
	record: Record<string, unknown>,
): Promise<boolean> {
	const body: Record<string, unknown> = { lead_id: leadId };
	for (const [k, v] of Object.entries(record)) {
		if (v !== undefined && v !== null && v !== '') body[k] = v;
	}
	try {
		await pluraApiRequest(ctx, 'PATCH', '/lead/update', { body });
		return true;
	} catch {
		return false;
	}
}

async function enrollLeadWithId(
	ctx: IExecuteFunctions,
	workflowId: string,
	leadId: string,
): Promise<IDataObject> {
	const res = await pluraApiRequest<Record<string, unknown>>(ctx, 'POST', '/lead/sendtoworkflow', {
		body: { workflow_id: workflowId, lead_id: leadId },
	});
	return (res || { success: true }) as IDataObject;
}

export class PluraAiAutomations implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Plura.ai Automations',
		name: 'pluraAiAutomations',
		icon: 'file:plura.png',
		group: ['transform'],
		version: 1,
		description: 'Plura.ai helps teams build, deploy, and manage AI agents for calls, chat, and workflows. Use Plura.ai to automate outreach, route conversations, and sync data across your tools.',
		defaults: {
			name: 'Plura.ai Automations',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'pluraAiAutomationsApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Lead', value: 'lead' },
					{ name: 'Call', value: 'call' },
				],
				default: 'lead',
			},

			// Lead operations
			{
				displayName: 'Operation',
				name: 'leadOperation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['lead'] } },
				options: [
					{ name: 'Get Lead by Phone', value: 'getLeadByPhone' },
					{ name: 'Get Lead by ID', value: 'getLeadById' },
					{ name: 'Update Lead', value: 'updateLead' },
					{ name: 'Send Lead to Workflow', value: 'sendLeadToWorkflow' },
					{ name: 'Add Tag', value: 'addTag' },
					{ name: 'Remove Tag', value: 'removeTag' },
				],
				default: 'getLeadByPhone',
			},

			{
				displayName: 'Phone (Lookup)',
				name: 'lookup_phone',
				type: 'string',
				required: true,
				default: '',
				placeholder: '17145551234',
				description: 'Phone number in E.164 format',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['getLeadByPhone'] } },
			},
			{
				displayName: 'Phone',
				name: 'phone',
				type: 'string',
				required: true,
				default: '',
				placeholder: '17145551234',
				description: 'Phone number in E.164 format',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Lead ID',
				name: 'lead_id',
				type: 'string',
				required: true,
				default: '',
				placeholder: '307fc241-8398-4740-8122-cf6a59f3b86e',
				displayOptions: {
					show: {
						resource: ['lead'],
						leadOperation: ['getLeadById', 'updateLead', 'addTag', 'removeTag'],
					},
				},
			},
			{
				displayName: 'Workspace',
				name: 'workspace_id',
				type: 'options',
				required: false,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getWorkspaces',
				},
				description: 'Plura workspace (optional, used to filter journeys)',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Workflow/Journey',
				name: 'workflow_id',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getJourneys',
					loadOptionsDependsOn: ['workspace_id'],
				},
				description: 'Journey to enroll the lead into',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['sendLeadToWorkflow'] } },
			},
			{
				displayName: 'First Name',
				name: 'first_name',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['updateLead', 'sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Last Name',
				name: 'last_name',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['updateLead', 'sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['updateLead', 'sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Phone (Update)',
				name: 'update_phone',
				type: 'string',
				default: '',
				placeholder: '17145551234',
				description: 'Update phone in E.164 format',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['updateLead'] } },
			},
			{
				displayName: 'Company',
				name: 'company',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['updateLead', 'sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Custom Fields (JSON)',
				name: 'custom_fields_json',
				type: 'string',
				default: '',
				placeholder: '{"field_name":"value"}',
				description: 'Optional JSON object of custom fields to set',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['updateLead', 'sendLeadToWorkflow'] } },
			},
			{
				displayName: 'Tag',
				name: 'tag',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'High_Priority',
				displayOptions: { show: { resource: ['lead'], leadOperation: ['addTag', 'removeTag'] } },
			},

			// Call operations
			{
				displayName: 'Operation',
				name: 'callOperation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['call'] } },
				options: [{ name: 'Initiate Call', value: 'initiateCall' }],
				default: 'initiateCall',
			},
			{
				displayName: 'Agent',
				name: 'agent',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getAgents',
				},
				displayOptions: { show: { resource: ['call'], callOperation: ['initiateCall'] } },
			},
			{
				displayName: 'Recipient Phone',
				name: 'call_to_phone',
				type: 'string',
				required: true,
				default: '',
				placeholder: '17145551234',
				displayOptions: { show: { resource: ['call'], callOperation: ['initiateCall'] } },
			},
			{
				displayName: 'From Phone (Plura Number)',
				name: 'call_from_phone',
				type: 'string',
				required: true,
				default: '',
				placeholder: '15045798220',
				displayOptions: { show: { resource: ['call'], callOperation: ['initiateCall'] } },
			},
			{
				displayName: 'Request Data (JSON)',
				name: 'request_data_json',
				type: 'string',
				default: '',
				placeholder: '{"first_name":"John","last_name":"Doe"}',
				displayOptions: { show: { resource: ['call'], callOperation: ['initiateCall'] } },
			},
		],
	};

	methods = {
		credentialTest: {
			async pluraAiAutomationsApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const { email, password } = credential.data as { email?: string; password?: string };
				
				if (!email || !password) {
					return {
						status: 'Error',
						message: 'Email and Password are required',
					};
				}

				try {
					const response = await this.helpers.request({
						method: 'POST',
						url: 'https://plura-lb.gynetix.com/backend/api/user/Authenticate.json',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							user: email,
							password: password,
						}),
						json: true,
					});

					if (response && response.status === 'success' && response.token) {
						return {
							status: 'OK',
							message: 'Connection successful!',
						};
					}

					return {
						status: 'Error',
						message: response?.message || 'Authentication failed. Please check your email and password.',
					};
				} catch (error: any) {
					const message = error?.message || 'Connection failed';
					return {
						status: 'Error',
						message: `Authentication failed: ${message}`,
					};
				}
			},
		},
		loadOptions: {
			async getWorkspaces(this: ILoadOptionsFunctions) {
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const resp = await requestJson<{ items: Array<{ label: string; value: string }> }>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/options/workspaces`,
					headers: { 'Content-Type': 'application/json' },
					body: { user: creds.email, password: creds.password },
				});
				return (resp.items || []).map((i) => ({ name: i.label, value: i.value }));
			},

			async getJourneys(this: ILoadOptionsFunctions) {
				const workspaceId = (this.getCurrentNodeParameter('workspace_id', {}) as string) || undefined;
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const resp = await requestJson<{ items: Array<{ label: string; value: string }> }>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/options/journeys`,
					headers: { 'Content-Type': 'application/json' },
					body: { user: creds.email, password: creds.password, workspace_id: workspaceId },
				});
				return (resp.items || []).map((i) => ({ name: i.label, value: i.value }));
			},

			async getAgents(this: ILoadOptionsFunctions) {
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const resp = await requestJson<{ items: Array<{ label: string; value: string }> }>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/options/agents`,
					headers: { 'Content-Type': 'application/json' },
					body: { user: creds.email, password: creds.password },
				});
				return (resp.items || []).map((i) => ({ name: i.label, value: i.value }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;

			if (resource === 'lead') {
				const operation = this.getNodeParameter('leadOperation', i) as string;

				if (operation === 'getLeadByPhone') {
					const phone = this.getNodeParameter('lookup_phone', i) as string;
					try {
						const res = await pluraApiRequest<Lead>(this, 'GET', '/lead/get', { qs: { phone } });
						returnData.push({ json: res || {} });
					} catch (err: any) {
						const statusCode = err?.httpCode ?? err?.statusCode;
						if (Number(statusCode) === 404) {
							returnData.push({ json: {} });
						} else {
							throw err;
						}
					}
					continue;
				}

				if (operation === 'getLeadById') {
					const leadId = this.getNodeParameter('lead_id', i) as string;
					try {
						const res = await pluraApiRequest<Lead>(this, 'GET', '/lead/get', { qs: { lead_id: leadId } });
						returnData.push({ json: res || {} });
					} catch (err: any) {
						const statusCode = err?.httpCode ?? err?.statusCode;
						if (Number(statusCode) === 404) {
							returnData.push({ json: {} });
						} else {
							throw err;
						}
					}
					continue;
				}

				if (operation === 'updateLead') {
					const leadId = this.getNodeParameter('lead_id', i) as string;
					const firstName = this.getNodeParameter('first_name', i) as string;
					const lastName = this.getNodeParameter('last_name', i) as string;
					const email = this.getNodeParameter('email', i) as string;
					const phone = this.getNodeParameter('update_phone', i) as string;
					const company = this.getNodeParameter('company', i) as string;
					const customFieldsJson = this.getNodeParameter('custom_fields_json', i) as string;

					const body: Record<string, unknown> = { lead_id: leadId };
					if (firstName) body.first_name = firstName;
					if (lastName) body.last_name = lastName;
					if (email) body.email = email;
					if (phone) body.phone = phone;
					if (company) body.company = company;

					const custom = parseOptionalJson(this, customFieldsJson, 'Invalid JSON in Custom Fields');
					if (custom) Object.assign(body, custom);

					const res = await pluraApiRequest<Record<string, unknown>>(this, 'PATCH', '/lead/update', { body });
					returnData.push({ json: (res || { success: true }) as IDataObject });
					continue;
				}

				if (operation === 'addTag') {
					const leadId = this.getNodeParameter('lead_id', i) as string;
					const tag = this.getNodeParameter('tag', i) as string;
					const res = await pluraApiRequest<Record<string, unknown>>(this, 'PATCH', '/lead/tag', {
						body: { lead_id: leadId, tag },
					});
					returnData.push({ json: (res || { success: true }) as IDataObject });
					continue;
				}

				if (operation === 'removeTag') {
					const leadId = this.getNodeParameter('lead_id', i) as string;
					const tag = this.getNodeParameter('tag', i) as string;
					const res = await pluraApiRequest<Record<string, unknown>>(this, 'DELETE', '/lead/tag', {
						qs: { lead_id: leadId, tag },
					});
					returnData.push({ json: (res || { success: true }) as IDataObject });
					continue;
				}

				if (operation === 'sendLeadToWorkflow') {
					const workflowId = this.getNodeParameter('workflow_id', i) as string;
					const phone = this.getNodeParameter('phone', i) as string;
					const firstName = this.getNodeParameter('first_name', i) as string;
					const lastName = this.getNodeParameter('last_name', i) as string;
					const email = this.getNodeParameter('email', i) as string;
					const company = this.getNodeParameter('company', i) as string;
					const customFieldsJson = this.getNodeParameter('custom_fields_json', i) as string;

					if (!workflowId) throw new NodeOperationError(this.getNode(), 'Workflow/Journey ID is required');
					if (!phone) throw new NodeOperationError(this.getNode(), 'Phone is required');

					const record: Record<string, unknown> = { phone };
					if (firstName) record.first_name = firstName;
					if (lastName) record.last_name = lastName;
					if (email) record.email = email;
					if (company) record.company = company;
					const custom = parseOptionalJson(this, customFieldsJson, 'Invalid JSON in Custom Fields');
					if (custom) Object.assign(record, custom);

					try {
						const existing = await findLeadByPhone(this, phone, record);
						if (existing?.lead_id) {
							const hasUpdatableFields = Object.keys(record).some(
								(k) => k !== 'phone' && record[k] !== undefined && record[k] !== null && record[k] !== '',
							);
							if (hasUpdatableFields) {
								await updateLeadById(this, existing.lead_id, record);
							}
							const enrolled = await enrollLeadWithId(this, workflowId, existing.lead_id);
							returnData.push({ json: enrolled });
							continue;
							}
						} catch {
							// Ignore and throw original
						}

					try {
						const res = await pluraApiRequest<Record<string, unknown>>(this, 'POST', '/lead/sendtoworkflow', {
							body: { workflow_id: workflowId, record },
						});
						returnData.push({ json: (res || { success: true }) as IDataObject });
						continue;
					} catch (err: any) {
						const message = err?.message ? String(err.message) : 'sendtoworkflow failed';

						try {
							const existing = await findLeadByPhone(this, phone, record);
							if (existing?.lead_id) {
								await updateLeadById(this, existing.lead_id, record);
						const enrolled = await enrollLeadWithId(this, workflowId, existing.lead_id);
						returnData.push({ json: enrolled });
								continue;
							}
						} catch {
							// Ignore and throw original
						}

						throw new NodeOperationError(this.getNode(), message);
					}
				}

				throw new NodeOperationError(this.getNode(), `Unsupported lead operation: ${operation}`);
			}

			if (resource === 'call') {
				const operation = this.getNodeParameter('callOperation', i) as string;
				if (operation !== 'initiateCall') {
					throw new NodeOperationError(this.getNode(), `Unsupported call operation: ${operation}`);
				}

				const agent = this.getNodeParameter('agent', i) as string;
				const toPhoneRaw = this.getNodeParameter('call_to_phone', i) as string;
				const fromPhoneRaw = this.getNodeParameter('call_from_phone', i) as string;
				const requestDataJson = this.getNodeParameter('request_data_json', i) as string;

				const toPhone = toPhoneRaw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
				const fromPhone = fromPhoneRaw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');

				const requestData = parseOptionalJson(this, requestDataJson, 'Invalid JSON in Request Data');

				const body: Record<string, unknown> = {
					agent,
					phone: toPhone,
					from: fromPhone,
				};
				if (requestData && Object.keys(requestData).length > 0) body.request_data = requestData;

				const res = await pluraApiRequest<Record<string, unknown>>(this, 'POST', '/agent', { body });
				returnData.push({ json: (res || { success: true }) as IDataObject });
				continue;
			}

			throw new NodeOperationError(this.getNode(), `Unsupported resource: ${resource}`);
		}

		return [returnData];
	}
}
