import { handleApiRequest } from '../../lib/api.js';

export function onRequest(context) {
	return handleApiRequest(context);
}
