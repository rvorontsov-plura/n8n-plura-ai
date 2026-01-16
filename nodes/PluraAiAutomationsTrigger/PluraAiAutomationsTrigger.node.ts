import type {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	getIntegrationsBaseUrl,
	getPluraCreds,
	requestJson,
} from '../common/PluraHelpers';

type OptionsResp = { items: Array<{ label: string; value: string }> };

export class PluraAiAutomationsTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Plura.ai Automations Trigger',
		name: 'pluraAiAutomationsTrigger',
		icon: 'file:plura.png',
		group: ['trigger'],
		version: 1,
		description: 'Triggers when a Plura.ai automation node is executed. Plura.ai helps teams build, deploy, and manage AI agents for calls, chat, and workflows.',
		defaults: {
			name: 'Plura.ai Automations Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [{ name: 'pluraAiAutomationsApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'plura-ai-automations',
			},
		],
		properties: [
			{
				displayName: 'Workspace',
				name: 'workspace_id',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getWorkspaces',
				},
				description: 'Plura workspace (used to load journeys)',
			},
			{
				displayName: 'Journey',
				name: 'journey_id',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getJourneys',
					loadOptionsDependsOn: ['workspace_id'],
				},
				description: 'Plura journey containing the automation node',
			},
			{
				displayName: 'Automation Node',
				name: 'automation_node_id',
				type: 'options',
				required: true,
				default: '',
				typeOptions: {
					loadOptionsMethod: 'getAutomationNodes',
					loadOptionsDependsOn: ['journey_id'],
				},
				description: 'Automation node to subscribe to',
			},
		],
	};

	methods = {
		loadOptions: {
			async getWorkspaces(this: ILoadOptionsFunctions) {
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const resp = await requestJson<OptionsResp>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/options/workspaces`,
					headers: { 'Content-Type': 'application/json' },
					body: { user: creds.email, password: creds.password },
				});
				return (resp.items || []).map((i) => ({ name: i.label, value: i.value }));
			},

			async getJourneys(this: ILoadOptionsFunctions) {
				const workspaceId = this.getCurrentNodeParameter('workspace_id') as string;
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const resp = await requestJson<OptionsResp>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/options/journeys`,
					headers: { 'Content-Type': 'application/json' },
					body: { user: creds.email, password: creds.password, workspace_id: workspaceId },
				});
				return (resp.items || []).map((i) => ({ name: i.label, value: i.value }));
			},

			async getAutomationNodes(this: ILoadOptionsFunctions) {
				const journeyId = this.getCurrentNodeParameter('journey_id') as string;
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const resp = await requestJson<OptionsResp>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/options/nodes`,
					headers: { 'Content-Type': 'application/json' },
					body: { user: creds.email, password: creds.password, journey_id: journeyId },
				});
				return (resp.items || []).map((i) => ({ name: i.label, value: i.value }));
			},
		},
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return false;
			},

			async create(this: IHookFunctions) {
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);
				const journeyId = this.getNodeParameter('journey_id') as string;
				const automationNodeId = this.getNodeParameter('automation_node_id') as string;
				const webhookUrl = this.getNodeWebhookUrl('default');

				if (!webhookUrl) {
					throw new NodeOperationError(this.getNode(), 'Failed to determine webhook URL');
				}

				const resp = await requestJson<{ hook_id?: string }>(this, {
					method: 'POST',
					url: `${baseUrl}/make-com/automation/subscribe`,
					headers: { 'Content-Type': 'application/json' },
					body: {
						journey_id: journeyId,
						automation_node_id: automationNodeId,
						webhook_url: webhookUrl,
						platform: 'n8n',
					},
				});

				const staticData = this.getWorkflowStaticData('node');
				staticData.pluraWebhookUrl = webhookUrl;
				staticData.pluraHookId = resp?.hook_id;

				return true;
			},

			async delete(this: IHookFunctions) {
				const creds = await getPluraCreds(this);
				const baseUrl = getIntegrationsBaseUrl(creds);

				const staticData = this.getWorkflowStaticData('node') as Record<string, unknown>;
				const storedWebhookUrl = typeof staticData.pluraWebhookUrl === 'string' ? staticData.pluraWebhookUrl : '';

				const webhookUrl = storedWebhookUrl || this.getNodeWebhookUrl('default');
				if (!webhookUrl) return true;

				await requestJson(this, {
					method: 'DELETE',
					url: `${baseUrl}/make-com/automation/unsubscribe`,
					headers: { 'Content-Type': 'application/json' },
					body: {
						webhook_url: webhookUrl,
					},
				});

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const body = this.getBodyData() as Record<string, string | number | boolean | null | undefined>;
		const accountIdValue = typeof body.accountId !== 'undefined' ? body.accountId : null;
		const accountIdFallback = typeof body.account_id !== 'undefined' ? body.account_id : null;
		const normalized = {
			...body,
			accountId: accountIdValue || accountIdFallback || null,
		};

		return {
			workflowData: [this.helpers.returnJsonArray([normalized])],
		};
	}
}
