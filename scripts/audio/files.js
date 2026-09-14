import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function replaceFileAtomic(temporaryPath, destinationPath) {
	const backupPath = `${destinationPath}.${process.pid}.${Date.now()}.bak`;
	let hadPrevious = false;
	try {
		try {
			await rename(destinationPath, backupPath);
			hadPrevious = true;
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		await rename(temporaryPath, destinationPath);
	} catch (error) {
		await rm(destinationPath, { force: true });
		if (hadPrevious) {
			try {
				await rename(backupPath, destinationPath);
			} catch (restoreError) {
				throw new AggregateError([error, restoreError], `替换 ${destinationPath} 失败，且旧文件恢复失败。`);
			}
		}
		throw error;
	} finally {
		await rm(temporaryPath, { force: true });
	}
	if (hadPrevious) await rm(backupPath, { force: true }).catch(() => {});
}

export async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

export async function readJsonIfExists(path) {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		if (error instanceof SyntaxError) throw new Error(`${path} 不是有效 JSON。`);
		throw error;
	}
}

export async function writeJsonAtomic(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
		await replaceFileAtomic(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

export async function writeTextAtomic(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporaryPath, value, 'utf8');
		await replaceFileAtomic(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

export async function sha256File(path) {
	const digest = createHash('sha256');
	digest.update(await readFile(path));
	return digest.digest('hex');
}

export async function copyFileAtomic(sourcePath, destinationPath) {
	await mkdir(dirname(destinationPath), { recursive: true });
	const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		await copyFile(sourcePath, temporaryPath);
		await replaceFileAtomic(temporaryPath, destinationPath);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}
