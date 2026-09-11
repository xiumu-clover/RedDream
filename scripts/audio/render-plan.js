import { hashJson, voiceAnnotationHash } from './audio-blocks.js';

export const RENDER_POLICY_VERSION = 'edge-semantic-v1';

const EMOTION_PRESETS = {
	anger: 'anger',
	sadness: 'sad',
	joy: 'joy',
	fear: 'fear',
	calm: 'neutral',
	mixed: 'neutral',
};
const PACE_DELTA = { slow: -10, medium: 0, fast: 8, urgent: 15, broken: -12 };
const PITCH_DELTA = { low: -3, medium: 0, high: 3 };
const ENERGY_DELTA = { light: -10, medium: 0, heavy: 8 };

function parseUnit(value, suffix, fallback = 0) {
	const match = new RegExp(`^([+-]?\\d+)${suffix.replace('%', '%')}$`, 'u').exec(String(value || ''));
	return match ? Number(match[1]) : fallback;
}

function signed(value, suffix) {
	const rounded = Math.round(value);
	return `${rounded >= 0 ? '+' : ''}${rounded}${suffix}`;
}

function profileAsCard(profile, cards, variant) {
	if (!profile || typeof profile !== 'object') {
		throw new Error(`缺少旁白配置 narratorProfiles.${variant}。`);
	}
	if (profile.voiceCardId) {
		const card = cards[profile.voiceCardId];
		if (!card) throw new Error(`旁白配置 ${variant} 引用了不存在的音色卡“${profile.voiceCardId}”。`);
		return card;
	}
	if (!profile.voice) throw new Error(`旁白配置 ${variant} 缺少 voice 或 voiceCardId。`);
	return {
		id: `$narrator:${variant}`,
		provider: profile.provider || 'edge',
		voice: profile.voice,
		prosody: {
			rate: profile.rate || '+0%',
			pitch: profile.pitch || '+0Hz',
			volume: profile.volume || '+0%',
		},
		emotions: { neutral: {} },
	};
}

export function resolveBlockRenderSpec({
	block,
	annotation,
	variant,
	config,
	cards,
	forcedProvider,
}) {
	const card = annotation.speakerRef === '$narrator'
		? profileAsCard(config.narratorProfiles?.[variant], cards, variant)
		: cards[annotation.speakerRef];
	if (!card) throw new Error(`语音块 ${block.blockId} 缺少音色卡“${annotation.speakerRef}”。`);
	if (!card.voice || !card.prosody) throw new Error(`音色卡“${card.id}”缺少 voice 或 prosody。`);

	const emotionPresetName = EMOTION_PRESETS[annotation.emotion.family] || 'neutral';
	const emotion = card.emotions?.[emotionPresetName] || card.emotions?.neutral || {};
	let rate = parseUnit(emotion.rate ?? card.prosody.rate, '%') + PACE_DELTA[annotation.pace];
	let pitch = parseUnit(emotion.pitch ?? card.prosody.pitch, 'Hz') + PITCH_DELTA[annotation.pitch];
	let volume = parseUnit(emotion.volume ?? card.prosody.volume, '%') + ENERGY_DELTA[annotation.energy];
	const warnings = [];

	if (annotation.modifiers.includes('whispering')) {
		rate -= 5;
		volume -= 20;
	}
	if (annotation.modifiers.includes('dream-murmur')) {
		rate -= 10;
		volume -= 12;
	}
	if (annotation.modifiers.includes('crying') || annotation.modifiers.includes('sobbing')) rate -= 6;
	if (annotation.modifiers.includes('choked') || annotation.modifiers.includes('hesitating')) rate -= 5;
	if (annotation.timbre.some((value) => ['sharp', 'hoarse', 'breathy'].includes(value))) {
		warnings.push(`${block.blockId} 的细腻音色标签只能由 Edge 近似表达。`);
	}
	for (const modifier of annotation.modifiers) {
		if (!['whispering', 'dream-murmur', 'crying', 'sobbing', 'choked', 'hesitating'].includes(modifier)) {
			warnings.push(`${block.blockId} 的 ${modifier} 修饰不会被 Edge 精确控制。`);
		}
	}

	rate = Math.max(-50, Math.min(100, rate));
	pitch = Math.max(-20, Math.min(20, pitch));
	volume = Math.max(-50, Math.min(50, volume));
	const spec = {
		provider: forcedProvider || card.provider || 'edge',
		voice: card.voice,
		rate: signed(rate, '%'),
		pitch: signed(pitch, 'Hz'),
		volume: signed(volume, '%'),
		voiceCardId: card.id,
		emotion: emotionPresetName,
	};
	const renderHash = hashJson({
		version: RENDER_POLICY_VERSION,
		textHash: block.textHash,
		annotationHash: voiceAnnotationHash(annotation),
		voiceCardHash: hashJson(card),
		spec,
	});
	return { spec, renderHash, warnings };
}
