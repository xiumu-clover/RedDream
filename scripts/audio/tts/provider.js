const PROVIDER_LOADERS = {
	edge: async () => {
		const { EdgeTtsProvider } = await import('./providers/edge.js');
		return EdgeTtsProvider;
	},
};

/**
 * @typedef {Object} TtsSegment
 * @property {string} text
 * @property {string} [voice]
 * @property {string} [rate]
 * @property {string} [pitch]
 * @property {string} [volume]
 * @property {string} [voiceCardId]
 * @property {string} [emotion]
 */

/**
 * @typedef {Object} TtsRequest
 * @property {string} [text]
 * @property {TtsSegment[]} [segments]
 * @property {string} outputPath
 * @property {(progress: {index: number, total: number, attempt: number, voiceCardId?: string, emotion?: string}) => void} [onProgress]
 */

/**
 * @typedef {Object} TtsProvider
 * @property {string} name
 * @property {Record<string, string | number>} settings
 * @property {({locale}?: {locale?: string}) => Promise<Record<string, unknown>[]>} [listVoices]
 * @property {(request: TtsRequest) => Promise<{path: string, chunks: number, bytes: number, durationSeconds: number}>} synthesizeToFile
 */

/**
 * Create the configured TTS provider without coupling the caller to its SDK.
 * Azure or Aliyun support only needs another loader with the same contract.
 *
 * @param {string} providerName
 * @param {Record<string, string | number | undefined>} options
 * @returns {Promise<TtsProvider>}
 */
export async function createTtsProvider(providerName = 'edge', options = {}) {
	const normalizedName = providerName.trim().toLowerCase();
	const loadProvider = PROVIDER_LOADERS[normalizedName];
	if (!loadProvider) {
		throw new Error(
			`不支持 TTS 服务商“${providerName}”。当前可用：${Object.keys(PROVIDER_LOADERS).join('、')}。`,
		);
	}

	const Provider = await loadProvider();
	const provider = new Provider(options);
	if (typeof provider.synthesizeToFile !== 'function') {
		throw new Error(`TTS 服务商“${providerName}”没有实现 synthesizeToFile()。`);
	}
	return provider;
}
