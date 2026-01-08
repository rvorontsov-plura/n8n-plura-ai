import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class PluraAiAutomationsApi implements ICredentialType {
	name = 'pluraAiAutomationsApi';
	displayName = 'Plura.ai Automations API';
	documentationUrl = 'https://integrations.plura.ai';
	properties: INodeProperties[] = [
		{
			displayName: 'Authentication Method',
			name: 'authMethod',
			type: 'options',
			options: [
				{
					name: 'Login with Email & Password',
					value: 'login',
				},
				{
					name: 'API Key',
					value: 'apiKey',
				},
			],
			default: 'login',
			description:
				'Choose how to authenticate: Login to get a bearer token automatically, or use an API key directly.',
		},
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			displayOptions: {
				show: {
					authMethod: ['login'],
				},
			},
			default: '',
			required: true,
			description:
				'Plura.ai account email. Used to authenticate and get a bearer token for API calls.',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			displayOptions: {
				show: {
					authMethod: ['login'],
				},
			},
			default: '',
			required: true,
			description: 'Plura.ai account password.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			displayOptions: {
				show: {
					authMethod: ['apiKey'],
				},
			},
			default: '',
			required: true,
			description:
				'Plura.ai API key. Used directly for action calls to https://api.plura.ai/v1/*',
		},
		{
			displayName: 'Bearer Token',
			name: 'bearerToken',
			type: 'string',
			typeOptions: { password: true },
			displayOptions: {
				show: {
					authMethod: ['login'],
				},
			},
			default: '',
			description:
				'JWT bearer token. Leave empty to auto-fetch on first use (requires Email + Password). You can also set this manually if you have a token.',
		},
		{
			displayName: 'Integrations Base URL',
			name: 'integrationsBaseUrl',
			type: 'string',
			default: 'https://integrations.plura.ai/api',
			description:
				'Base URL for Plura integrations backend (used for trigger subscribe/unsubscribe and dropdown options).',
		},
		{
			displayName: 'Plura API Base URL',
			name: 'pluraApiBaseUrl',
			type: 'string',
			default: 'https://api.plura.ai/v1',
			description: 'Base URL for Plura public API (used for actions).',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.bearerToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://plura-lb.gynetix.com',
			url: '/backend/api/user/Authenticate.json',
			method: 'POST',
			body: {
				user: '={{$credentials.email}}',
				password: '={{$credentials.password}}',
			},
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'status',
					value: 'success',
					message: 'Authentication failed',
				},
			},
		],
		// Note: The response includes a 'token' field which is the JWT bearer token.
		// Users can copy this token and paste it into the 'Bearer Token' field for faster subsequent requests.
		// If Bearer Token is left empty, nodes will automatically authenticate on-demand.
	};
}




