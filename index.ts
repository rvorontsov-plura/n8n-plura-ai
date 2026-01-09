import { PluraAiAutomationsApi } from './credentials/PluraAiAutomationsApi.credentials';
import { PluraAiAutomations } from './nodes/PluraAiAutomations/PluraAiAutomations.node';
import { PluraAiAutomationsTrigger } from './nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node';

export const credentials = {
	PluraAiAutomationsApi,
};

export const nodes = {
	PluraAiAutomations,
	PluraAiAutomationsTrigger,
};
