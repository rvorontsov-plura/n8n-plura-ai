import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class PluraAiAutomationsApi implements ICredentialType {
	name = 'pluraAiAutomationsApi';
	displayName = 'Plura.ai Automations API';
	documentationUrl = 'https://plura.ai';
	testedBy = 'pluraAiAutomationsApiTest';

	properties: INodeProperties[] = [
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			default: '',
			required: true,
			description: 'Plura.ai account email',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Plura.ai account password',
		},
		{
			displayName: 'API Key (Optional)',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: false,
			description: 'If provided, will be used instead of email/password for API calls',
		},
	];
}
