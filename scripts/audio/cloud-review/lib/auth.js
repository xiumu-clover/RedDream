let cachedKeys;
let cachedKeysAt = 0;

function base64UrlBytes(value) {
	const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
	const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
	const binary = atob(padded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function jsonPart(value) {
	return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}

function audienceMatches(actual, expected) {
	return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
}

export async function verifyAccessToken(token, env, fetcher = fetch) {
	if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new Error('缺少 Cloudflare Access 凭据。');
	const parts = token.split('.');
	if (parts.length !== 3) throw new Error('Access JWT 格式无效。');
	const header = jsonPart(parts[0]);
	const payload = jsonPart(parts[1]);
	if (header.alg !== 'RS256' || !header.kid) throw new Error('Access JWT 签名算法无效。');
	const teamDomain = String(env.ACCESS_TEAM_DOMAIN).replace(/\/$/u, '');
	const now = Math.floor(Date.now() / 1000);
	if (payload.iss !== teamDomain || !audienceMatches(payload.aud, env.ACCESS_AUD)
		|| !Number.isFinite(payload.exp) || payload.exp <= now
		|| (Number.isFinite(payload.nbf) && payload.nbf > now + 30)) {
		throw new Error('Access JWT 声明无效或已经过期。');
	}
	if (!cachedKeys || Date.now() - cachedKeysAt > 300_000) {
		const response = await fetcher(`${teamDomain}/cdn-cgi/access/certs`);
		if (!response.ok) throw new Error('无法读取 Access 公钥。');
		cachedKeys = (await response.json()).keys;
		cachedKeysAt = Date.now();
	}
	const jwk = cachedKeys?.find((key) => key.kid === header.kid);
	if (!jwk) {
		cachedKeys = undefined;
		throw new Error('Access JWT 使用了未知公钥。');
	}
	const key = await crypto.subtle.importKey(
		'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
	);
	const valid = await crypto.subtle.verify(
		'RSASSA-PKCS1-v1_5', key, base64UrlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
	);
	if (!valid) throw new Error('Access JWT 签名无效。');
	return payload;
}

async function constantTimeBearer(request, secret, errorMessage) {
	const supplied = request.headers.get('Authorization') || '';
	const expected = `Bearer ${secret || ''}`;
	if (!secret || supplied.length !== expected.length) throw new Error(errorMessage);
	const [left, right] = await Promise.all([
		crypto.subtle.digest('SHA-256', new TextEncoder().encode(supplied)),
		crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected)),
	]);
	const leftBytes = new Uint8Array(left);
	const rightBytes = new Uint8Array(right);
	let difference = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < Math.max(leftBytes.length, rightBytes.length); index += 1) {
		difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
	}
	if (difference !== 0) throw new Error(errorMessage);
}

export async function authenticateReviewer(request, env) {
	if (env.REVIEWER_TOKEN) {
		await constantTimeBearer(request, env.REVIEWER_TOKEN, '评审链接凭据无效。');
		return 'project-owner';
	}
	const payload = await verifyAccessToken(request.headers.get('Cf-Access-Jwt-Assertion'), env);
	return payload.email || payload.sub || 'project-owner';
}

export async function authenticateSync(request, env) {
	await constantTimeBearer(request, env.REVIEW_SYNC_TOKEN, '同步凭据无效。');
	return 'production-sync';
}
